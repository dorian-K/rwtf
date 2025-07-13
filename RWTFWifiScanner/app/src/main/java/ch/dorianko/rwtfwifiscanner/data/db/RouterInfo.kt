package ch.dorianko.rwtfwifiscanner.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "router_info")
data class RouterInfo(
    @PrimaryKey val bssid: String, // BSSID is the unique MAC address of the access point
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long
)