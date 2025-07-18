package ch.dorianko.rwtfwifiscanner.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import ch.dorianko.rwtfwifiscanner.R
import ch.dorianko.rwtfwifiscanner.data.db.AppDatabase
import ch.dorianko.rwtfwifiscanner.data.db.RouterInfo
import ch.dorianko.rwtfwifiscanner.data.network.RouterApiService
import com.google.android.gms.location.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class MappingService : Service() {

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var currentLocation: Location? = null

    private val db by lazy { AppDatabase.getDatabase(this) }
    private val connectivityManager by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private var currentBssid: String? = null

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "WifiMappingChannel"
        const val NOTIFICATION_ID = 1
        const val ACTION_START_SERVICE = "ACTION_START_SERVICE"
        const val ACTION_STOP_SERVICE = "ACTION_STOP_SERVICE"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_SERVICE -> startMapping()
            ACTION_STOP_SERVICE -> stopMapping()
        }
        return START_STICKY
    }

    private fun startMapping() {
        startForeground(NOTIFICATION_ID, createNotification("Starting service..."))
        Log.d("MappingService", "Service started.")
        setupLocationUpdates()
        registerNetworkCallback()
    }

    private fun stopMapping() {
        Log.d("MappingService", "Service stopping.")
        fusedLocationClient.removeLocationUpdates(locationCallback)
        connectivityManager.unregisterNetworkCallback(networkCallback)
        serviceJob.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun setupLocationUpdates() {
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10000) // 10 seconds
            .setMinUpdateIntervalMillis(5000) // 5 seconds
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                currentLocation = locationResult.lastLocation
                Log.d("MappingService", "Location updated: ${currentLocation?.latitude}, ${currentLocation?.longitude}")
                updateNotification("Scanning... Last location: ${currentLocation?.latitude?.format(4)}, ${currentLocation?.longitude?.format(4)}")
            }
        }

        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper())
        }
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            super.onAvailable(network)
            val networkCapabilities = connectivityManager.getNetworkCapabilities(network)
            if (networkCapabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) {
                Log.d("MappingService", "Wi-Fi connection available.")

                // Give the system a moment to fully establish the connection
                serviceScope.launch {
                    kotlinx.coroutines.delay(2000)
                    // CHANGED: Pass the network object
                    processNewWifiConnection(network)
                }
            }
        }
    }

    private fun registerNetworkCallback() {
        connectivityManager.registerDefaultNetworkCallback(networkCallback)
    }

    private fun processNewWifiConnection(network: Network) {
        val hasPermission = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        Log.d("MappingService", "Checking for BSSID. Has ACCESS_FINE_LOCATION permission? $hasPermission")

        val wifiManager = this.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val wifiInfo2 = wifiManager.getConnectionInfo()
        val ssid = wifiInfo2.getSSID()
        val bssid = wifiInfo2.getBSSID()

        if (ssid == null || bssid == currentBssid || bssid == "02:00:00:00:00:00") {
            Log.d("MappingService", "Ignoring invalid or duplicate SSID: $bssid")
            return // Ignore invalid or already processed BSSID
        }
        currentBssid = bssid

        // --- MODERN API for Gateway IP ---
        val linkProperties = connectivityManager.getLinkProperties(network)
        val gatewayIp = linkProperties?.routes?.firstOrNull { it.isDefaultRoute }?.gateway?.hostAddress

        if (gatewayIp.isNullOrEmpty()) {
            Log.e("MappingService", "Could not get gateway IP.")
            //return
        }

        Log.d("MappingService", "New Wi-Fi connected. SSID: $ssid, BSSID: $bssid, Gateway: $gatewayIp")
        updateNotification("Connected to $ssid. Fetching data...")

        fetchRouterInfoAndSave(bssid)
    }

    private fun fetchRouterInfoAndSave(bssid: String) {
        serviceScope.launch {
            if (currentLocation == null) {
                Log.w("MappingService", "Location not available yet. Skipping save.")
                updateNotification("Error: Location not available.")
                return@launch
            }

            try {
                Log.i("MappingService", "Getting ap info...")
                // Create a new Retrofit instance for each gateway
                val retrofit = Retrofit.Builder()
                    //.baseUrl("https://rwtf.dorianko.ch/api/v1/")
                    .baseUrl("https://findme.rwth-aachen.de/")
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()

                val apiService = retrofit.create(RouterApiService::class.java)
                val response = apiService.getRouterInfo()
                //val response = apiService.getIp()

                if (response.isSuccessful && response.body() != null) {
                    //val routerName = response.body()!!.routerName
                    //val routerName = response.body()!!.query
                    val html = response.body()!!.html
                //val routerName = "dummy router"
                    val doc: Document = Jsoup.parse(html)

                    val data = mutableMapOf<String, String>()

                    // First table (key-value pairs)
                    val firstTable = doc.select("table").first()
                    firstTable?.select("tr")?.forEach { row ->
                        val th = row.selectFirst("th")?.text()?.trim()
                        val td = row.selectFirst("td")?.text()?.trim()
                        if (th != null && td != null) {
                            data[th] = td
                            Log.i("MappingService", "$th: $td")
                        }
                    }
                    val routerName: String = data["Access Point"]!!
                    val routerData = RouterInfo(
                        bssid = bssid,
                        name = routerName,
                        latitude = currentLocation!!.latitude,
                        longitude = currentLocation!!.longitude,
                        timestamp = System.currentTimeMillis(),
                        fullHtml = html
                    )
                    db.routerInfoDao().insert(routerData)
                    Log.i("MappingService", "SUCCESS: Saved data for $routerName ($bssid)")
                    updateNotification("Saved: $routerName")
                } else {
                    Log.e("MappingService", "API call failed: ${response.code()} - ${response.message()}")
                    Log.e("MappingService", response.toString())
                    updateNotification("Error: Failed to fetch info")
                }

            } catch (e: Exception) {
                Log.e("MappingService", "Exception during API call: ${e.message}")
                updateNotification("Error: Could not connect")
            } finally {
                // Reset BSSID after processing to allow re-mapping if needed
                // currentBssid = null
            }
        }
    }
    
    // Helper to format double for display
    private fun Double.format(digits: Int) = "%.${digits}f".format(this)

    private fun createNotification(text: String): Notification {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Wi-Fi Mapping Service",
            NotificationManager.IMPORTANCE_LOW
        )
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Wi-Fi Mapper Active")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground) // Replace with your icon
            .setOngoing(true)
            .build()
    }
    
    private fun updateNotification(text: String) {
        val notification = createNotification(text)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        super.onDestroy()
        serviceJob.cancel()
    }
}