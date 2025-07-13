package ch.dorianko.rwtfwifiscanner.data.network

import retrofit2.Response
import retrofit2.http.GET

interface RouterApiService {
    // The path to the info endpoint
    @GET("info")
    suspend fun getRouterInfo(): Response<RouterApiResponse>

    @GET("gym_interpline?dayoffset=0")
    suspend fun getIp(): Response<IpApiResponse>

}