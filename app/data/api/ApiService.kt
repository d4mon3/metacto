import com.example.featurevoting.data.models.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // User Service Endpoints
    @POST("/auth/register")
    suspend fun register(@Body user: UserRequest): Response<AuthResponse>

    @POST("/auth/login")
    suspend fun login(@Body user: UserRequest): Response<AuthResponse>

    @POST("/auth/refresh")
    suspend fun refreshToken(@Body refreshToken: RefreshTokenRequest): Response<AuthResponse>

    // Feature Service Endpoints
    @GET("/features")
    suspend fun getFeatures(): Response<ApiResponse<List<Feature>>>

    @POST("/features")
    suspend fun createFeature(@Body feature: FeatureRequest): Response<ApiResponse<Feature>>

    @GET("/features/{id}")
    suspend fun getFeatureDetails(@Path("id") featureId: Int): Response<ApiResponse<Feature>>

    // Voting Service Endpoints
    @POST("/votes")
    suspend fun castVote(@Body vote: VoteRequest): Response<ApiResponse<Vote>>

    @DELETE("/votes/{id}")
    suspend fun removeVote(@Path("id") voteId: Int): Response<ApiResponse<Any>>
}