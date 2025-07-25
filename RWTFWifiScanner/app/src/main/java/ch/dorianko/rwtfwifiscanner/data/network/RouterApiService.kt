package ch.dorianko.rwtfwifiscanner.data.network

import retrofit2.Response
import retrofit2.http.GET

interface RouterApiService {
    @GET("client-info.json")
    suspend fun getRouterInfo(): Response<RouterApiResponse>

}