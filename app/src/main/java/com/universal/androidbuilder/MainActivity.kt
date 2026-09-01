package com.universal.androidbuilder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.StatFs
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import com.google.android.gms.nearby.connection.Strategy.P2P_STAR
import com.universal.androidbuilder.ui.theme.UniversalBuilderTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

private const val SERVICE_ID = "com.universal.androidbuilder.technician"
private const val PORT = 8765
private val NEARBY_STRATEGY = P2P_STAR

class MainActivity : ComponentActivity() {
    private var role by mutableStateOf("choose")
    private var status by mutableStateOf("Ready")
    private var transport by mutableStateOf("Not connected")
    private var targetInfo by mutableStateOf("No target detected")
    private var targetTelemetry by mutableStateOf("Waiting for live telemetry")
    private var nearbyEndpointId: String? = null
    private var masterHost: String? = null
    private var server: HostServer? = null
    private var wifiP2pManager: WifiP2pManager? = null
    private var wifiP2pChannel: WifiP2pManager.Channel? = null
    private val deviceId = UUID.randomUUID().toString()
    private val connectionsClient by lazy { Nearby.getConnectionsClient(this) }
    private var pendingPermissionAction: (() -> Unit)? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants.values.all { it }) {
            val action = pendingPermissionAction
            pendingPermissionAction = null
            action?.invoke()
        } else {
            pendingPermissionAction = null
            status = "Nearby permissions are required. Connection not started."
        }
    }

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
            // Auto-pair is limited to the explicitly selected MASTER/TARGET companion roles.
            connectionsClient.acceptConnection(endpointId, payloadCallback)
                .addOnFailureListener { status = "Nearby accept failed: ${it.message ?: "unknown error"}" }
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
                nearbyEndpointId = endpointId
                transport = "Nearby Connections — P2P"
                status = "CONNECTED · Nearby Connections"
                if (role == "master") {
                    targetInfo = "Authorized target connected via Nearby"
                } else {
                    startTelemetryLoop()
                }
            } else {
                nearbyEndpointId = null
                status = "Nearby connection failed · trying Wi-Fi Direct fallback"
                startWifiDirectFallback()
            }
        }

        override fun onDisconnected(endpointId: String) {
            if (nearbyEndpointId == endpointId) nearbyEndpointId = null
            transport = "Nearby disconnected"
            status = "Nearby disconnected · trying Wi-Fi Direct fallback"
            if (role != "choose") startWifiDirectFallback()
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            if (role == "master") {
                try {
                    val body = JSONObject(String(bytes, Charsets.UTF_8))
                    targetInfo = "Target: ${body.optString("model", "Android device")} · ${body.optString("android", "Android") }"
                    targetTelemetry = "Battery ${body.optInt("battery", -1)}% · Wi-Fi ${body.optInt("signal", -999)} dBm · ${body.optDouble("temp", 0.0)}°C · Free ${body.optString("storage_free_gb", "?")} GB"
                    status = "TARGET CONNECTED · LIVE TELEMETRY"
                } catch (_: Exception) {
                    status = "Received Nearby payload"
                }
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    private val wifiPeerListListener = WifiP2pManager.PeerListListener { peers ->
        if (role != "target") return@PeerListListener
        val candidate = peers.deviceList.firstOrNull()
        if (candidate == null) {
            status = "No Wi-Fi Direct peer found yet"
            return@PeerListListener
        }
        connectWifiDirectPeer(candidate)
    }

    private val wifiConnectionInfoListener = WifiP2pManager.ConnectionInfoListener { info ->
        if (!info.groupFormed) return@ConnectionInfoListener
        if (info.isGroupOwner) {
            transport = "Wi-Fi Direct — group owner"
            status = "MASTER READY · Wi-Fi Direct fallback"
            startHostServer()
        } else {
            val owner = info.groupOwnerAddress
            if (owner != null) {
                masterHost = owner.hostAddress
                transport = "Wi-Fi Direct — P2P"
                status = "TARGET CONNECTED · Wi-Fi Direct fallback"
                startTelemetrySocketLoop(owner)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        wifiP2pManager = getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager
        wifiP2pChannel = wifiP2pManager?.initialize(this, mainLooper, null)
        setContent {
            UniversalBuilderTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TechnicianCompanionScreen(
                        role = role,
                        status = status,
                        transport = transport,
                        targetInfo = targetInfo,
                        targetTelemetry = targetTelemetry,
                        onMaster = { startMaster() },
                        onTarget = { startTarget() },
                        onStop = { stopAll() }
                    )
                }
            }
        }
    }

    private fun requiredPermissions(): Array<String> {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            permissions += Manifest.permission.BLUETOOTH_SCAN
            permissions += Manifest.permission.BLUETOOTH_ADVERTISE
            permissions += Manifest.permission.BLUETOOTH_CONNECT
        } else if (Build.VERSION.SDK_INT >= 29) {
            permissions += Manifest.permission.ACCESS_FINE_LOCATION
        } else {
            permissions += Manifest.permission.ACCESS_COARSE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= 32) permissions += Manifest.permission.NEARBY_WIFI_DEVICES
        return permissions.toTypedArray()
    }

    private fun hasRequiredPermissions(): Boolean = requiredPermissions().all {
        checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermissionsThen(action: () -> Unit) {
        if (hasRequiredPermissions()) {
            action()
        } else {
            pendingPermissionAction = action
            permissionLauncher.launch(requiredPermissions())
        }
    }

    private fun startMaster() {
        stopAll()
        role = "master"
        status = "Starting Nearby advertising..."
        requestPermissionsThen { startNearbyAdvertising() }
    }

    private fun startTarget() {
        stopAll()
        role = "target"
        status = "Scanning nearby for AI Technician..."
        requestPermissionsThen { startNearbyDiscovery() }
    }

    private fun startNearbyAdvertising() {
        connectionsClient.stopAllEndpoints()
        connectionsClient.stopAdvertising()
        connectionsClient.stopDiscovery()
        val options = AdvertisingOptions.Builder().setStrategy(NEARBY_STRATEGY).build()
        connectionsClient.startAdvertising(
            "AI-Tech-MASTER-${deviceId.take(6)}",
            SERVICE_ID,
            connectionLifecycleCallback,
            options
        ).addOnSuccessListener {
            transport = "Nearby Connections — advertising"
            status = "MASTER DISCOVERABLE · waiting for Target"
        }.addOnFailureListener {
            status = "Nearby unavailable · starting Wi-Fi Direct fallback"
            startWifiDirectFallback()
        }
    }

    private fun startNearbyDiscovery() {
        connectionsClient.stopDiscovery()
        connectionsClient.stopAdvertising()
        val options = DiscoveryOptions.Builder().setStrategy(NEARBY_STRATEGY).build()
        connectionsClient.startDiscovery(
            SERVICE_ID,
            object : EndpointDiscoveryCallback() {
                override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
                    status = "Master found · requesting Nearby connection"
                    connectionsClient.requestConnection(
                        "AI-Tech-TARGET-${deviceId.take(6)}",
                        endpointId,
                        connectionLifecycleCallback
                    ).addOnFailureListener {
                        status = "Nearby request failed · trying Wi-Fi Direct fallback"
                        startWifiDirectFallback()
                    }
                }

                override fun onEndpointLost(endpointId: String) {
                    if (nearbyEndpointId == endpointId) nearbyEndpointId = null
                }
            },
            options
        ).addOnSuccessListener {
            transport = "Nearby Connections — discovering"
            status = "SEARCHING FOR MASTER"
        }.addOnFailureListener {
            status = "Nearby discovery unavailable · starting Wi-Fi Direct fallback"
            startWifiDirectFallback()
        }
    }

    private fun startTelemetryLoop() {
        lifecycleScope.launch(Dispatchers.IO) {
            while (role == "target" && nearbyEndpointId != null) {
                val endpoint = nearbyEndpointId ?: break
                val bytes = collectTelemetry().toString().toByteArray(Charsets.UTF_8)
                connectionsClient.sendPayload(endpoint, Payload.fromBytes(bytes))
                delay(3000)
            }
        }
    }

    private fun startWifiDirectFallback() {
        if (role == "choose") return
        if (!hasRequiredPermissions()) {
            status = "Waiting for Nearby/Wi-Fi permissions for fallback"
            requestPermissionsThen { startWifiDirectFallback() }
            return
        }
        val manager = wifiP2pManager ?: return
        val channel = wifiP2pChannel ?: return
        transport = "Wi-Fi Direct — fallback"
        if (role == "master") {
            status = "Starting Wi-Fi Direct group..."
            manager.createGroup(channel, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { manager.requestConnectionInfo(channel, wifiConnectionInfoListener) }
                override fun onFailure(reason: Int) { status = "Wi-Fi Direct master failed ($reason)" }
            })
        } else {
            status = "Discovering nearby Wi-Fi Direct devices..."
            manager.discoverPeers(channel, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    status = "Wi-Fi Direct peers found · selecting nearby Master"
                    manager.requestPeers(channel, wifiPeerListListener)
                }
                override fun onFailure(reason: Int) {
                    status = "Wi-Fi Direct discovery failed ($reason) · enable Location and Wi-Fi, then retry"
                }
            })
        }
    }

    private fun connectWifiDirectPeer(device: WifiP2pDevice) {
        val manager = wifiP2pManager ?: return
        val channel = wifiP2pChannel ?: return
        val config = WifiP2pConfig().apply { deviceAddress = device.deviceAddress }
        status = "Connecting to ${device.deviceName.ifBlank { "nearby device" }} via Wi-Fi Direct..."
        manager.connect(channel, config, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { manager.requestConnectionInfo(channel, wifiConnectionInfoListener) }
            override fun onFailure(reason: Int) { status = "Wi-Fi Direct connection failed ($reason)" }
        })
    }

    private fun startHostServer() {
        server?.stop()
        server = HostServer(PORT) { path, body ->
            if (path == "/telemetry") {
                targetInfo = "Target: ${body.optString("model", "Android device")} · ${body.optString("android", "Android")}"
                targetTelemetry = "Battery ${body.optInt("battery", -1)}% · Wi-Fi ${body.optInt("signal", -999)} dBm · ${body.optDouble("temp", 0.0)}°C · Free ${body.optString("storage_free_gb", "?")} GB"
                status = "TARGET CONNECTED · LIVE TELEMETRY"
            }
            "{\"ok\":true}"
        }
        server?.start()
    }

    private fun startTelemetrySocketLoop(owner: InetAddress) {
        lifecycleScope.launch(Dispatchers.IO) {
            while (role == "target" && masterHost == owner.hostAddress) {
                try {
                    postJson(owner.hostAddress, PORT, "/telemetry", collectTelemetry())
                } catch (_: Exception) {
                    // Fallback transport is best-effort.
                }
                delay(3000)
            }
        }
    }

    private fun collectTelemetry(): JSONObject {
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        val battery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val tempIntent = registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
        val temp = (tempIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
        val wifi = getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
        val signal = wifi.connectionInfo?.rssi ?: -127
        val stat = StatFs(filesDir.absolutePath)
        val freeGb = stat.availableBytes / 1024.0 / 1024.0 / 1024.0
        return JSONObject()
            .put("device_id", deviceId)
            .put("model", Build.MODEL)
            .put("android", "Android ${Build.VERSION.RELEASE}")
            .put("battery", battery)
            .put("signal", signal)
            .put("temp", temp)
            .put("storage_free_gb", String.format("%.1f", freeGb))
            .put("timestamp", System.currentTimeMillis())
    }

    private fun postJson(host: String, port: Int, path: String, body: JSONObject): Boolean {
        return try {
            val socket = Socket(host, port)
            socket.soTimeout = 5000
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
            val payload = body.toString()
            writer.write("POST $path HTTP/1.1\r\nHost: $host\r\nContent-Type: application/json\r\nContent-Length: ${payload.toByteArray().size}\r\nConnection: close\r\n\r\n$payload")
            writer.flush()
            val response = BufferedReader(InputStreamReader(socket.getInputStream())).readLine() ?: ""
            socket.close()
            response.contains(" 200 ")
        } catch (_: Exception) { false }
    }

    private fun stopAll() {
        connectionsClient.stopAllEndpoints()
        connectionsClient.stopAdvertising()
        connectionsClient.stopDiscovery()
        nearbyEndpointId = null
        masterHost = null
        server?.stop(); server = null
        role = "choose"
        transport = "Not connected"
        status = "Ready"
        targetInfo = "No target detected"
        targetTelemetry = "Waiting for live telemetry"
        try {
            val manager = wifiP2pManager
            val channel = wifiP2pChannel
            if (manager != null && channel != null) manager.removeGroup(channel, null)
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        stopAll()
        super.onDestroy()
    }
}

private class HostServer(private val port: Int, private val handler: (String, JSONObject) -> String) {
    private var socket: ServerSocket? = null
    private val executor = Executors.newCachedThreadPool()

    fun start() {
        executor.execute {
            try {
                socket = ServerSocket(port)
                while (!socket!!.isClosed) executor.execute { handle(socket!!.accept()) }
            } catch (_: Exception) {}
        }
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 5000
            val input = BufferedReader(InputStreamReader(client.getInputStream()))
            val first = input.readLine() ?: return
            val path = first.split(" ").getOrElse(1) { "/" }
            var length = 0
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                if (line.startsWith("Content-Length:", true)) length = line.substringAfter(":").trim().toIntOrNull() ?: 0
            }
            val bodyText = CharArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(bodyText, read, length - read)
                if (n <= 0) break
                read += n
            }
            val body = try { JSONObject(String(bodyText, 0, read)) } catch (_: Exception) { JSONObject() }
            val response = handler(path, body)
            val bytes = response.toByteArray()
            val writer = OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8)
            writer.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n$response")
            writer.flush()
        } catch (_: Exception) {
            // Ignore individual connection failures.
        } finally {
            try { client.close() } catch (_: Exception) {}
        }
    }

    fun stop() {
        try { socket?.close() } catch (_: Exception) {}
        executor.shutdownNow()
    }
}

@Composable
private fun TechnicianCompanionScreen(
    role: String,
    status: String,
    transport: String,
    targetInfo: String,
    targetTelemetry: String,
    onMaster: () -> Unit,
    onTarget: () -> Unit,
    onStop: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("AI Android Technician Companion", style = MaterialTheme.typography.headlineSmall)
        Text("Hotspot-free nearby pairing: Nearby Connections first, Wi-Fi Direct fallback")
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Status", style = MaterialTheme.typography.titleMedium)
                Text(status)
                Text("Transport: $transport")
                Text("Mode: ${if (role == "choose") "Not selected" else role.uppercase()}")
            }
        }
        if (role == "choose") {
            Button(onClick = onMaster, modifier = Modifier.fillMaxWidth()) { Text("This phone is MASTER") }
            OutlinedButton(onClick = onTarget, modifier = Modifier.fillMaxWidth()) { Text("This phone is TARGET") }
        } else {
            if (role == "master") {
                Text("Nearby advertising is active. The Target companion can discover this phone without an SSID/password.")
                Text("Target", style = MaterialTheme.typography.titleMedium)
                Text(targetInfo)
                Text(targetTelemetry)
            } else {
                Text("Searching nearby. When the Master is found, the app requests the connection automatically.")
                Text("If Nearby Connections cannot start, Wi-Fi Direct is used as the fallback.")
            }
            OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) { Text("Stop") }
        }
        Text("Authorization: the companion apps auto-accept the transport connection only after the user selects MASTER or TARGET; OS permissions are still required. Diagnostics remain read-only by default.", style = MaterialTheme.typography.bodySmall)
    }
}
