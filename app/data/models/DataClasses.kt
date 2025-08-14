package com.example.featurevoting.data.models

import com.google.gson.annotations.SerializedName

// Generic API response format
data class ApiResponse<T>(
    val success: Boolean,
    val message: String,
    val data: T?,
    val error: String?,
    val timestamp: String
)

data class User(
    val id: Int,
    val username: String,
    val email: String,
    @SerializedName("first_name") val firstName: String?,
    @SerializedName("last_name") val lastName: String?,
    @SerializedName("created_at") val createdAt: String
)

data class Feature(
    val id: Int,
    val title: String,
    val description: String,
    @SerializedName("user_id") val userId: Int,
    val status: String,
    val priority: String,
    @SerializedName("votes_count") val votesCount: Int,
    @SerializedName("created_at") val createdAt: String
)

data class Vote(
    val id: Int,
    @SerializedName("user_id") val userId: Int,
    @SerializedName("feature_id") val featureId: Int,
    @SerializedName("vote_type") val voteType: String,
    @SerializedName("created_at") val createdAt: String
)

data class AuthResponse(
    val success: Boolean,
    val message: String,
    val data: AuthData?,
    val error: String?
)

data class AuthData(
    @SerializedName("jwt_token") val jwtToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
    val user: User
)

// Request bodies
data class UserRequest(val username: String, val email: String, val password_hash: String)
data class RefreshTokenRequest(val refreshToken: String)
data class FeatureRequest(val title: String, val description: String)
data class VoteRequest(val userId: Int, val featureId: Int, val voteType: String)