// api.test.js
const request = require('supertest');

// The base URL for your API Gateway.
// In a real scenario, this would be the IP of your load balancer or your domain name.
// For a local setup, this might be 'http://localhost:3000' or similar.
const API_URL = 'http://localhost:3000';

// We'll store the JWT token here to use in subsequent authenticated requests.
let jwtToken = '';
let featureId = '';
let createdUserId = '';

// --- Test Suite for User Authentication and Profile ---
describe('User Authentication API', () => {

  // Test Case: Register a new user
  test('should register a new user successfully and return a JWT', async () => {
    // Generate a unique username and email for each test run to avoid conflicts
    const uniqueId = Date.now();
    const newUser = {
      username: `testuser_${uniqueId}`,
      email: `testuser_${uniqueId}@example.com`,
      password: 'password123',
      firstName: 'Test',
      lastName: 'User'
    };

    // Make a POST request to the registration endpoint
    const response = await request(API_URL)
      .post('/auth/register')
      .send(newUser);

    // Assertions for a successful registration
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('jwtToken');
    expect(response.body.data).toHaveProperty('refreshToken');

    // Store the JWT token and user ID for later use in other tests
    jwtToken = response.body.data.jwtToken;
    createdUserId = response.body.data.user.id;
  });

  // Test Case: Login with the newly registered user
  test('should log in an existing user successfully and return a new JWT', async () => {
    // Use the same username and password from the previous registration test
    const userCredentials = {
      username: `testuser_${createdUserId}`,
      password: 'password123'
    };

    // Make a POST request to the login endpoint
    const response = await request(API_URL)
      .post('/auth/login')
      .send(userCredentials);

    // Assertions for a successful login
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('jwtToken');
    expect(response.body.data).toHaveProperty('refreshToken');

    // Update the JWT token for subsequent tests
    jwtToken = response.body.data.jwtToken;
  });

  // Test Case: Access a protected route without a token
  test('should return 401 Unauthorized when accessing a protected route without a token', async () => {
    // Attempt to get features without providing any token
    const response = await request(API_URL)
      .get('/features')
      .set('Authorization', ''); // Explicitly set an empty token

    // Expect a 401 Unauthorized status
    expect(response.status).toBe(401);
  });
});

// --- Test Suite for Feature Management ---
describe('Feature Management API', () => {
  // Test Case: Create a new feature
  test('should create a new feature successfully', async () => {
    // Feature data to be sent
    const newFeature = {
      title: `Test Feature ${Date.now()}`,
      description: 'This is a test description for a new feature.'
    };

    // Make a POST request with the stored JWT token
    const response = await request(API_URL)
      .post('/features')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(newFeature);

    // Assertions for successful feature creation
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data.title).toBe(newFeature.title);
    
    // Store the new feature's ID for subsequent tests
    featureId = response.body.data.id;
  });

  // Test Case: Get all features and verify the newly created one is present
  test('should retrieve all features including the newly created one', async () => {
    const response = await request(API_URL)
      .get('/features')
      .set('Authorization', `Bearer ${jwtToken}`);

    // Assertions for the feature list
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    
    // Check if the feature we just created exists in the list
    const foundFeature = response.body.data.find(f => f.id === featureId);
    expect(foundFeature).toBeDefined();
    expect(foundFeature.title).toBe(`Test Feature ${Date.now() - 1}`); // Check if title matches (adjusted due to async timing)
  });
});

// --- Test Suite for Voting Functionality ---
describe('Voting API', () => {
  // Test Case: Vote for a feature
  test('should successfully upvote a feature', async () => {
    // The vote data, using the featureId created earlier
    const voteData = {
      featureId: featureId
    };

    // Make a POST request to the voting endpoint
    const response = await request(API_URL)
      .post('/votes')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(voteData);

    // Assertions for a successful vote
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Vote registered successfully');
  });

  // Test Case: Verify the vote count for a feature
  test('should have an incremented vote count after a vote is cast', async () => {
    // Get the feature details after the vote
    const response = await request(API_URL)
      .get(`/features/${featureId}`)
      .set('Authorization', `Bearer ${jwtToken}`);

    // Assertions for the updated vote count
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('votes_count');
    // We expect the count to be at least 1, as we just voted
    expect(response.body.data.votes_count).toBeGreaterThan(0);
  });
});
