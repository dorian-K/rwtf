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
import ch.dorianko.rwtfwifiscanner.data.network.ApEntry
import ch.dorianko.rwtfwifiscanner.data.network.RouterApiService
import ch.dorianko.rwtfwifiscanner.data.network.RwtfApiService
import ch.dorianko.rwtfwifiscanner.data.network.RwtfUploadPayload
import com.google.android.gms.location.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

class MappingService : Service() {

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var currentLocation: Location? = null

    private val db by lazy { AppDatabase.getDatabase(this) }
    private val connectivityManager by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    private var currentBssid: String? = null
    private var timeOfLastInsert: Long = 0

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "WifiMappingChannel"
        const val NOTIFICATION_ID = 1
        const val ACTION_START_SERVICE = "ACTION_START_SERVICE"
        const val ACTION_STOP_SERVICE = "ACTION_STOP_SERVICE"
        const val ACTION_UPLOAD = "ACTION_UPLOAD"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_SERVICE -> startMapping()
            ACTION_STOP_SERVICE -> stopMapping()
            ACTION_UPLOAD -> upload()
            else -> Log.w("MappingService", "Unknown action: ${intent?.action}")
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
    
    private fun upload(){
        serviceScope.launch {
            val data = db.routerInfoDao().getAllRouterInfo()
            if (data.isEmpty()) {
                Log.w("MappingService", "No data to upload.")
                updateNotification("No data to upload.")
                return@launch
            }

            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }
            val okHttpClient = OkHttpClient.Builder()
                .addInterceptor(logging)
                .connectTimeout(30, TimeUnit.SECONDS)   // Time to establish the connection
                .readTimeout(30, TimeUnit.SECONDS)      // Time to wait for data from server
                .writeTimeout(30, TimeUnit.SECONDS)     // Time to send data to server
                .build()                // Create a new Retrofit instance for each gateway
            val retrofit = Retrofit.Builder()
                .baseUrl("https://rwtf.dorianko.ch/api/v1/")
                .addConverterFactory(GsonConverterFactory.create())
                .client(okHttpClient)
                .build()

            val apiService = retrofit.create(RwtfApiService::class.java)
            val uploadPayload = RwtfUploadPayload(
                deviceId = getSharedPreferences("prefs", MODE_PRIVATE).getString(
                    "device_id",
                    "default-id"
                ) ?: "default-id",
                version = 1,
                data = data.map { // maybe more efficient to use a map here...
                    ApEntry(
                        bssid = it.bssid,
                        name = it.name,
                        latitude = it.latitude,
                        longitude = it.longitude,
                        timestamp = it.timestamp
                    )
                }
            )
            val response = apiService.upload(uploadPayload)

            if(response.isSuccessful){
                Log.i("MappingService", "Upload successful: ${response.body()?.ok}")
                updateNotification("Upload successful!")
            }else{
                Log.e("MappingService", "Upload failed: ${response.code()} - ${response.message()}")
                updateNotification("Upload failed: ${response.code()} - ${response.message()}")
            }
        }
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
                serviceScope.launch {
                    triggerGetLocation()
                }
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
                    triggerGetLocation()
                }
            }
        }
    }

    private fun registerNetworkCallback() {
        connectivityManager.registerDefaultNetworkCallback(networkCallback)
    }

    private fun triggerGetLocation() {
        val hasPermission = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        Log.d("MappingService", "Checking for BSSID. Has ACCESS_FINE_LOCATION permission? $hasPermission")

        val wifiManager = this.getSystemService(WIFI_SERVICE) as WifiManager
        val wifiInfo2 = wifiManager.getConnectionInfo()
        val ssid = wifiInfo2.getSSID()
        val bssid = wifiInfo2.getBSSID()

        if (ssid == null || bssid == "02:00:00:00:00:00") {
            Log.d("MappingService", "Ignoring invalid or duplicate SSID: $bssid")
            return // Ignore invalid or already processed BSSID
        }
        if (bssid == currentBssid && (System.currentTimeMillis() - timeOfLastInsert < 30000)) {
            // If the same BSSID has been processed within 30 seconds, ignore it
            Log.i("MappingService", "Ignoring already processed BSSID: $bssid")
            return // Ignore already processed BSSID
        }

        currentBssid = bssid

        Log.d("MappingService", "New Wi-Fi connected. SSID: $ssid, BSSID: $bssid")

        updateNotification("Connected to $ssid. Fetching data...")

        fetchRouterInfoAndSave(bssid)
    }

    private val fetchRouterSyncLock = Semaphore(1)
    private fun fetchRouterInfoAndSave(bssid: String) {
        serviceScope.launch {
            if (currentLocation == null) {
                Log.w("MappingService", "Location not available yet. Skipping save.")
                updateNotification("Error: Location not available.")
                return@launch
            }

            if(!fetchRouterSyncLock.tryAcquire()) {
                Log.w("MappingService", "Another fetch is in progress. Skipping this one.")
                return@launch // If another fetch is in progress, skip this one
            }
            try {
                Log.i("MappingService", "Getting ap info...")


                val logging = HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BODY
                }

                val okHttpClient = OkHttpClient.Builder()
                    .addInterceptor(logging)
                    .connectTimeout(30, TimeUnit.SECONDS)   // Time to establish the connection
                    .readTimeout(30, TimeUnit.SECONDS)      // Time to wait for data from server
                    .writeTimeout(30, TimeUnit.SECONDS)     // Time to send data to server
                    .build()                // Create a new Retrofit instance for each gateway
                val retrofit = Retrofit.Builder()
                    .baseUrl("https://findme.rwth-aachen.de/")
                    .addConverterFactory(GsonConverterFactory.create())
                    .client(okHttpClient)
                    .build()

                val apiService = retrofit.create(RouterApiService::class.java)
                val response = apiService.getRouterInfo()
                //val response = apiService.getIp()

                if (response.isSuccessful && response.body() != null) {
                    //val routerName = response.body()!!.routerName
                    //val routerName = response.body()!!.query
                    val html = response.body()!!.html
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
                        id = 0,
                        bssid = bssid,
                        name = routerName,
                        latitude = currentLocation!!.latitude,
                        longitude = currentLocation!!.longitude,
                        timestamp = System.currentTimeMillis(),
                        fullHtml = html
                    )
                    db.routerInfoDao().insert(routerData)
                    timeOfLastInsert = System.currentTimeMillis()
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
                currentBssid = null // Reset current BSSID on error so it can retry
            } finally {
                fetchRouterSyncLock.release() // Always unlock the lock
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