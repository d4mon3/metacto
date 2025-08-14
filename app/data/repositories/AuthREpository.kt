package com.example.featurevoting.data.repositories

import android.content.SharedPreferences
import com.example.featurevoting.data.api.ApiService
import com.example.featurevoting.data.models.AuthData
import com.example.featurevoting.data.models.UserRequest
import com.example.featurevoting.utils.Constants
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val sharedPreferences: SharedPreferences
) {
    suspend fun login(userRequest: UserRequest): AuthData {
        val response = apiService.login(userRequest)
        if (response.isSuccessful && response.body()?.data != null) {
            val authData = response.body()!!.data!!
            saveTokens(authData.jwtToken, authData.refreshToken)
            return authData
        }
        throw Exception("Login failed: ${response.body()?.error ?: response.message()}")
    }

    suspend fun register(userRequest: UserRequest): AuthData {
        val response = apiService.register(userRequest)
        if (response.isSuccessful && response.body()?.data != null) {
            val authData = response.body()!!.data!!
            saveTokens(authData.jwtToken, authData.refreshToken)
            return authData
        }
        throw Exception("Registration failed: ${response.body()?.error ?: response.message()}")
    }

    fun logout() {
        sharedPreferences.edit().apply {
            remove(Constants.JWT_TOKEN_KEY)
            remove(Constants.REFRESH_TOKEN_KEY)
            apply()
        }
    }

    private fun saveTokens(jwtToken: String, refreshToken: String) {
        sharedPreferences.edit().apply {
            putString(Constants.JWT_TOKEN_KEY, jwtToken)
            putString(Constants.REFRESH_TOKEN_KEY, refreshToken)
            apply()
        }
    }
}