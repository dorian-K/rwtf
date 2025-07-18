package ch.dorianko.rwtfwifiscanner.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "router_info")
data class RouterInfo(
    @PrimaryKey(autoGenerate = true)
    val id: Long,
    val bssid: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long,
    val fullHtml: String
)