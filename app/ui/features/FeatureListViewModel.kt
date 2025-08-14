package com.example.featurevoting.ui.features

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.featurevoting.data.models.Feature
import com.example.featurevoting.data.repositories.FeatureRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FeatureListViewModel @Inject constructor(
    private val featureRepository: FeatureRepository
) : ViewModel() {

    private val _features = MutableStateFlow<List<Feature>>(emptyList())
    val features: StateFlow<List<Feature>> = _features

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    init {
        fetchFeatures()
    }

    fun fetchFeatures() {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val result = featureRepository.getFeatures()
                _features.value = result
            } catch (e: Exception) {
                _errorMessage.value = "Failed to fetch features: ${e.message}"
            } finally {
                _isLoading.value = false
            }
        }
    }
}