package ch.dorianko.rwtfwifiscanner.data.db

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface RouterInfoDao {
    // Replace the entry if we map the same router again (useful for updates)
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(routerInfo: RouterInfo)

    @Query("SELECT * FROM router_info ORDER BY timestamp DESC")
    fun getAllRouterInfo(): LiveData<List<RouterInfo>>
}