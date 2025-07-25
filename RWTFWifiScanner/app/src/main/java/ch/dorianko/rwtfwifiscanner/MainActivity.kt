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
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import ch.dorianko.rwtfwifiscanner.data.db.AppDatabase
import ch.dorianko.rwtfwifiscanner.databinding.ActivityMainBinding
import ch.dorianko.rwtfwifiscanner.service.MappingService
import ch.dorianko.rwtfwifiscanner.ui.RouterInfoAdapter
import java.util.UUID
import androidx.core.content.edit

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

        binding.uploadBtn.setOnClickListener {
            val prefs = getSharedPreferences("prefs", MODE_PRIVATE)
            val savedId = prefs.getString("device_id", null)

            if (savedId == null) {
                // No ID yet, show prompt
                promptForDeviceId(prefs)
            } else {
                if (hasPermissions()) {
                    startServiceWithAction(MappingService.ACTION_UPLOAD)
                } else {
                    requestPermissionsLauncher.launch(permissions)
                }
            }
        }
    }

    private fun promptForDeviceId(prefs: android.content.SharedPreferences) {
        val editText = EditText(this)
        val defaultId = "id-" + UUID.randomUUID().toString().substring(0, 8).uppercase()
        editText.hint = "e.g., $defaultId"

        AlertDialog.Builder(this)
            .setTitle("Enter Device ID")
            .setMessage("You can provide a custom ID, or leave it empty to use a default one.")
            .setView(editText)
            .setCancelable(false)
            .setPositiveButton("Save") { _, _ ->
                val input = editText.text.toString().trim()
                val deviceId = input.ifEmpty { defaultId }
                prefs.edit { putString("device_id", deviceId) }
                Toast.makeText(this, "Device ID set: $deviceId", Toast.LENGTH_LONG).show()

                if (hasPermissions()) {
                    startServiceWithAction(MappingService.ACTION_UPLOAD)
                } else {
                    requestPermissionsLauncher.launch(permissions)
                }
            }
            .setNegativeButton("Cancel") { _, _ ->
                Toast.makeText(this, "App requires a device ID to continue.", Toast.LENGTH_LONG).show()
            }
            .show()
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
        db.routerInfoDao().getSomeRouterInfo().observe(this) { routerList ->
            routerAdapter.submitList(routerList)
        }

        db.routerInfoDao().getNumRouters().observe(this) {
            num ->
            binding.numRouters.text = "${num}"
        }
    }
}