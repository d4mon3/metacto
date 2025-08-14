package com.example.featurevoting.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.featurevoting.data.models.UserRequest
import com.example.featurevoting.data.repositories.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _loginState = MutableStateFlow<AuthResult>(AuthResult.Idle)
    val loginState: StateFlow<AuthResult> = _loginState

    private val _registerState = MutableStateFlow<AuthResult>(AuthResult.Idle)
    val registerState: StateFlow<AuthResult> = _registerState

    private val _user = MutableStateFlow<com.example.featurevoting.data.models.User?>(null)
    val user: StateFlow<com.example.featurevoting.data.models.User?> = _user

    sealed class AuthResult {
        object Idle : AuthResult()
        object Loading : AuthResult()
        data class Success(val message: String) : AuthResult()
        data class Error(val message: String) : AuthResult()
    }

    fun login(userRequest: UserRequest) {
        viewModelScope.launch {
            _loginState.value = AuthResult.Loading
            try {
                val authData = authRepository.login(userRequest)
                _user.value = authData.user
                _loginState.value = AuthResult.Success("Login successful!")
            } catch (e: Exception) {
                _loginState.value = AuthResult.Error(e.message ?: "An unknown error occurred.")
            }
        }
    }

    fun register(userRequest: UserRequest) {
        viewModelScope.launch {
            _registerState.value = AuthResult.Loading
            try {
                val authData = authRepository.register(userRequest)
                _user.value = authData.user
                _registerState.value = AuthResult.Success("Registration successful! You are now logged in.")
            } catch (e: Exception) {
                _registerState.value = AuthResult.Error(e.message ?: "An unknown error occurred.")
            }
        }
    }

    fun logout() {
        authRepository.logout()
        _user.value = null
    }
}