package ch.dorianko.rwtfwifiscanner.data.db

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface RouterInfoDao {
    // Replace the entry if we map the same router again (useful for updates)
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(routerInfo: RouterInfo)

    @Query("SELECT * FROM router_info ORDER BY timestamp")
    fun getAllRouterInfo(): List<RouterInfo>
    @Query("SELECT * FROM router_info ORDER BY timestamp DESC LIMIT 200")
    fun getSomeRouterInfo(): LiveData<List<RouterInfo>>

    @Query("SELECT COUNT(*) FROM router_info")
    fun getNumRouters(): LiveData<Integer>
}