package ch.dorianko.rwtfwifiscanner.data.network

import com.google.gson.annotations.SerializedName

data class IpApiResponse(
    @SerializedName("queryMs") // The key in the JSON response
    val query: String
)
