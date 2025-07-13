package ch.dorianko.rwtfwifiscanner

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import ch.dorianko.rwtfwifiscanner.ui.theme.RWTFWifiScannerTheme
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import ch.dorianko.rwtfwifiscanner.data.db.AppDatabase
import ch.dorianko.rwtfwifiscanner.databinding.ActivityMainBinding
import ch.dorianko.rwtfwifiscanner.service.MappingService
import ch.dorianko.rwtfwifiscanner.ui.RouterInfoAdapter

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val db by lazy { AppDatabase.getDatabase(this) }
    private val routerAdapter = RouterInfoAdapter()

    private val permissions = mutableListOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_WIFI_STATE,
        Manifest.permission.CHANGE_WIFI_STATE
    ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // No specific permission for notification needed if service is foreground
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // Android 14+
            add(Manifest.permission.FOREGROUND_SERVICE_LOCATION)
        }
    }.toTypedArray()

    private val requestPermissionsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            if (permissions.entries.all { it.value }) {
                startServiceWithAction(MappingService.ACTION_START_SERVICE)
            } else {
                Toast.makeText(this, "Permissions are required to run the service.", Toast.LENGTH_LONG).show()
                binding.toggleServiceButton.isChecked = false
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupRecyclerView()
        observeRouterData()

        binding.toggleServiceButton.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                handleStartService()
            } else {
                startServiceWithAction(MappingService.ACTION_STOP_SERVICE)
            }
        }
    }


    private fun handleStartService() {
        if (hasPermissions()) {
            startServiceWithAction(MappingService.ACTION_START_SERVICE)
        } else {
            requestPermissionsLauncher.launch(permissions)
        }
    }

    private fun startServiceWithAction(action: String) {
        val serviceIntent = Intent(this, MappingService::class.java).apply {
            this.action = action
        }
        ContextCompat.startForegroundService(this, serviceIntent)
    }

    private fun hasPermissions(): Boolean {
        return permissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun setupRecyclerView() {
        binding.recyclerView.apply {
            adapter = routerAdapter
            layoutManager = LinearLayoutManager(this@MainActivity)
        }
    }

    private fun observeRouterData() {
        db.routerInfoDao().getAllRouterInfo().observe(this) { routerList ->
            routerAdapter.submitList(routerList)
        }
    }
}