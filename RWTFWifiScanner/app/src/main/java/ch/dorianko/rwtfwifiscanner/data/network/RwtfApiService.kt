package ch.dorianko.rwtfwifiscanner.data.network;

import com.google.gson.annotations.SerializedName
import retrofit2.http.GET;
import retrofit2.Response;
import retrofit2.http.Body
import retrofit2.http.POST

interface RwtfApiService {
    @POST("upload")
    suspend fun upload(@Body body: RwtfUploadPayload): Response<RwtfUploadResponse>

}

data class RwtfUploadPayload(
    val deviceId: String,
    val version: Long,
    val data: List<ApEntry>
)
data class ApEntry(
    val bssid: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long
)

data class RwtfUploadResponse(
    @SerializedName("ok") // The key in the JSON response
    val ok: Boolean
)
