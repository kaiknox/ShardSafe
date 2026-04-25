export default () => {
  const ws = new WebSocket('ws://localhost:8080');

  // Handle incoming messages
  ws.onmessage = (event) => {
    console.log(`Received message: ${event.data}`);
    // Handle the received message as required
  };

  // Handle connection open
  ws.onopen = () => {
    console.log('WebSocket connection established');
    // Perform any necessary actions when the connection is open
  };

  // Handle connection close
  ws.onclose = () => {
    console.log('WebSocket connection closed');
    // Perform any necessary actions when the connection is closed
  };

  // Handle connection errors
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    // Perform any necessary error handling
  };

  // Return the WebSocket instance to allow interaction with it
  return ws;
};