package com.universal.androidbuilder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
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
import com.universal.androidbuilder.ui.theme.UniversalBuilderTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

private const val SERVICE_TYPE = "_aitech._tcp."
private const val PORT = 8765

class MainActivity : ComponentActivity() {
    private var role by mutableStateOf("choose")
    private var status by mutableStateOf("Ready")
    private var targetInfo by mutableStateOf("No target detected")
    private var targetTelemetry by mutableStateOf("Waiting for live telemetry")
    private var hotspotSsid by mutableStateOf("")
    private var hotspotPassword by mutableStateOf("")
    private var hotspotStatus by mutableStateOf("Hotspot not started")
    private var server: HostServer? = null
    private var discovery: TargetDiscovery? = null
    private var hotspotReservation: WifiManager.LocalOnlyHotspotReservation? = null
    private val deviceId = UUID.randomUUID().toString()

    private val nearbyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startTargetDiscovery() else status = "Nearby devices permission is required for automatic discovery"
    }

    private val hotspotPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRealHotspot() else {
            hotspotStatus = "Nearby devices permission denied"
            status = "Allow Nearby devices so this phone can create the technician hotspot"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            UniversalBuilderTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TechnicianCompanionScreen(
                        role = role,
                        status = status,
                        targetInfo = targetInfo,
                        targetTelemetry = targetTelemetry,
                        hotspotSsid = hotspotSsid,
                        hotspotPassword = hotspotPassword,
                        hotspotStatus = hotspotStatus,
                        onMaster = { startMaster() },
                        onTarget = { requestTargetPermissionAndStart() },
                        onStop = { stopAll() }
                    )
                }
            }
        }
    }

    private fun startMaster() {
        stopAll()
        role = "master"
        status = "Starting real local-only Wi-Fi hotspot..."
        hotspotStatus = "Requesting Android hotspot..."
        startRealHotspot()
    }

    private fun startRealHotspot() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            hotspotStatus = "Waiting for Nearby devices permission"
            hotspotPermission.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
            return
        }

        val wifi = getSystemService(WIFI_SERVICE) as WifiManager
        try {
            wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
                    hotspotReservation = reservation
                    val config = if (Build.VERSION.SDK_INT >= 30) reservation.softApConfiguration else null
                    hotspotSsid = config?.ssid ?: ""
                    hotspotPassword = if (Build.VERSION.SDK_INT >= 30) {
                        config?.passphrase ?: ""
                    } else {
                        @Suppress("DEPRECATION")
                        reservation.wifiConfiguration?.preSharedKey ?: ""
                    }
                    hotspotStatus = "HOTSPOT READY — open Wi-Fi on the Target phone and connect"
                    status = "MASTER HOTSPOT READY"
                    startHostServices()
                }

                override fun onStopped() {
                    hotspotStatus = "Hotspot stopped by Android or the user"
                    if (role == "master") status = "HOTSPOT STOPPED"
                }

                override fun onFailed(reason: Int) {
                    hotspotStatus = when (reason) {
                        WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE -> "Hotspot failed: incompatible Wi-Fi/tethering mode"
                        WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED -> "Hotspot failed: tethering is disallowed on this device"
                        WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL -> "Hotspot failed: no Wi-Fi channel available"
                        else -> "Hotspot failed: Android error $reason"
                    }
                    status = hotspotStatus
                }
            }, null)
        } catch (security: SecurityException) {
            hotspotStatus = "Hotspot permission error: ${security.message ?: "Nearby devices permission required"}"
            status = hotspotStatus
        } catch (error: Exception) {
            hotspotStatus = "Could not start hotspot: ${error.message ?: "unknown error"}"
            status = hotspotStatus
        }
    }

    private fun startHostServices() {
        server?.stop()
        server = HostServer(PORT) { path, body ->
            if (path == "/register") {
                targetInfo = "Authorized target: ${body.optString("model", "Android device")} · ${body.optString("android", "Android") }"
                status = "TARGET CONNECTED"
                "{\"ok\":true,\"master\":\"$deviceId\"}"
            } else if (path == "/telemetry") {
                targetTelemetry = "Battery ${body.optInt("battery", -1)}% · Wi-Fi ${body.optInt("signal", -999)} dBm · ${body.optDouble("temp", 0.0)}°C"
                "{\"ok\":true}"
            } else "{\"ok\":false}"
        }
        server?.start()
        advertiseMaster()
    }

    private fun requestTargetPermissionAndStart() {
        role = "target"
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            status = "Allow Nearby devices to enable automatic hotspot discovery"
            nearbyPermission.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else startTargetDiscovery()
    }

    private fun startTargetDiscovery() {
        stopDiscoveryOnly()
        status = "Scanning hotspot for AI Technician host..."
        discovery = TargetDiscovery(this) { host, port -> connectToMaster(host, port) }
        discovery?.start()
    }

    private fun connectToMaster(host: String, port: Int) {
        status = "Master found · requesting authorization..."
        lifecycleScope.launch(Dispatchers.IO) {
            val device = JSONObject()
                .put("device_id", deviceId)
                .put("model", Build.MODEL)
                .put("android", "Android ${Build.VERSION.RELEASE}")
            val registered = postJson(host, port, "/register", device)
            if (registered) {
                launch(Dispatchers.Main) { status = "TARGET AUTHORIZED · LIVE" }
                while (role == "target") {
                    val t = collectTelemetry()
                    postJson(host, port, "/telemetry", t)
                    delay(3000)
                }
            } else launch(Dispatchers.Main) { status = "Master rejected connection" }
        }
    }

    private fun collectTelemetry(): JSONObject {
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        val battery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val tempIntent = registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
        val temp = (tempIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
        val wifi = getSystemService(WIFI_SERVICE) as WifiManager
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

    private fun advertiseMaster() {
        val nsd = getSystemService(Context.NSD_SERVICE) as NsdManager
        val info = NsdServiceInfo().apply {
            serviceName = "AI-Tech-${deviceId.take(6)}"
            serviceType = SERVICE_TYPE
            port = PORT
        }
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {}
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) { status = "Hotspot discovery advertisement failed: $errorCode" }
            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        })
    }

    private fun stopDiscoveryOnly() { discovery?.stop(); discovery = null }

    private fun stopAll() {
        hotspotReservation?.close()
        hotspotReservation = null
        role = "choose"
        server?.stop(); server = null
        stopDiscoveryOnly()
        hotspotSsid = ""
        hotspotPassword = ""
        hotspotStatus = "Hotspot not started"
        status = "Ready"
        targetInfo = "No target detected"
        targetTelemetry = "Waiting for live telemetry"
    }

    override fun onDestroy() { stopAll(); super.onDestroy() }
}

private class TargetDiscovery(private val context: Context, private val onFound: (String, Int) -> Unit) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) {}
        override fun onServiceFound(info: NsdServiceInfo) {
            if (info.serviceType == SERVICE_TYPE) {
                nsd.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                        onFound(serviceInfo.host.hostAddress, serviceInfo.port)
                    }
                })
            }
        }
        override fun onServiceLost(info: NsdServiceInfo) {}
        override fun onDiscoveryStopped(type: String) {}
        override fun onStartDiscoveryFailed(type: String, errorCode: Int) { stop() }
        override fun onStopDiscoveryFailed(type: String, errorCode: Int) {}
    }
    fun start() { nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
    fun stop() { try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {} }
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
            val parts = first.split(" ")
            val path = parts.getOrElse(1) { "/" }
            var length = 0
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                if (line.startsWith("Content-Length:", true)) length = line.substringAfter(":").trim().toIntOrNull() ?: 0
            }
            val bodyText = CharArray(length)
            var read = 0
            while (read < length) { val n = input.read(bodyText, read, length - read); if (n <= 0) break; read += n }
            val body = try { JSONObject(String(bodyText, 0, read)) } catch (_: Exception) { JSONObject() }
            val response = handler(path, body)
            val bytes = response.toByteArray()
            val writer = OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8)
            writer.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n$response")
            writer.flush()
            client.close()
        } catch (_: Exception) { try { client.close() } catch (_: Exception) {} }
    }
    fun stop() { try { socket?.close() } catch (_: Exception) {}; executor.shutdownNow() }
}

@Composable
private fun TechnicianCompanionScreen(
    role: String,
    status: String,
    targetInfo: String,
    targetTelemetry: String,
    hotspotSsid: String,
    hotspotPassword: String,
    hotspotStatus: String,
    onMaster: () -> Unit,
    onTarget: () -> Unit,
    onStop: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(18.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("AI Android Technician Companion", style = MaterialTheme.typography.headlineSmall)
        Text("Real Android local hotspot → Wi-Fi connection → automatic discovery → authorized telemetry")
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Status", style = MaterialTheme.typography.titleMedium)
                Text(status)
                Text("Mode: ${if (role == "choose") "Not selected" else role.uppercase()}")
            }
        }
        if (role == "choose") {
            Button(onClick = onMaster, modifier = Modifier.fillMaxWidth()) { Text("This phone is MASTER") }
            OutlinedButton(onClick = onTarget, modifier = Modifier.fillMaxWidth()) { Text("This phone is TARGET") }
        } else {
            if (role == "master") {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Real Wi-Fi hotspot", style = MaterialTheme.typography.titleMedium)
                        Text(hotspotStatus)
                        if (hotspotSsid.isNotBlank()) Text("Wi-Fi name (SSID): $hotspotSsid")
                        if (hotspotPassword.isNotBlank()) Text("Wi-Fi password: $hotspotPassword")
                        Text("On the Target phone, open Wi-Fi and connect to this SSID using the password above.")
                    }
                }
                Text("Target", style = MaterialTheme.typography.titleMedium)
                Text(targetInfo)
                Text(targetTelemetry)
            } else {
                Text("After the Target phone connects to the Master's Wi-Fi hotspot, this companion searches for the technician host automatically.")
                Text("No pairing code is required.")
            }
            OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) { Text("Stop") }
        }
        Text("Safety: diagnostics are read-only by default. OS-level actions require explicit authorization on the target device.", style = MaterialTheme.typography.bodySmall)
    }
}
