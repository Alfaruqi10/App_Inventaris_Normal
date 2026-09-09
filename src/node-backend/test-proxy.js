import axios from 'axios';

async function runTests() {
  console.log('=== STARTING PROXY ROUTING VERIFICATION TESTS ===');
  
  // Test 1: POST request with action 'ping'
  try {
    console.log('\n[Test 1] Sending POST / with action="ping"...');
    const res = await axios.post('http://localhost:5000/', { action: 'ping' });
    console.log('Response Status:', res.status);
    console.log('Response Payload:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('[Test 1 Failed] HTTP Error:', err.message);
  }

  // Test 2: GET request with action 'ping'
  try {
    console.log('\n[Test 2] Sending GET /?action=ping...');
    const res = await axios.get('http://localhost:5000/', { params: { action: 'ping' } });
    console.log('Response Status:', res.status);
    console.log('Response Payload:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('[Test 2 Failed] HTTP Error:', err.message);
  }
  
  console.log('\n=== TESTING COMPLETED ===');
}

runTests();
