package ch.dorianko.rwtfwifiscanner.data.network

import com.google.gson.annotations.SerializedName

data class RouterApiResponse(
    @SerializedName("html") // The key in the JSON response
    val html: String
)
