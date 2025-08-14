package com.example.featurevoting.data.repositories

import com.example.featurevoting.data.api.ApiService
import com.example.featurevoting.data.models.Feature
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FeatureRepository @Inject constructor(
    private val apiService: ApiService
) {
    suspend fun getFeatures(): List<Feature> {
        val response = apiService.getFeatures()
        if (response.isSuccessful && response.body()?.data != null) {
            return response.body()!!.data!!
        }
        throw Exception("Failed to fetch features: ${response.message()}")
    }
}