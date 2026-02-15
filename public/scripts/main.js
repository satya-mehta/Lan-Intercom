const socket = io();
const peerConnections = {};
let localStream;
const pcadip = ''; // Configuration for IP if needed

// DOM Elements
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('video-grid');
const endCallBtn = document.getElementById('endCallButton');
const btnMic = document.getElementById('btn-mic');
const btnCam = document.getElementById('btn-camera');

// --- Cookie Helpers ---
function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

// --- Initialization ---
let userName = getCookie('userName');
if (!userName) {
  userName = prompt('Enter your name:');
  if (userName) setCookie('userName', userName, 365);
}

if (userName) {
  socket.emit('register-device', { name: userName });
}

// --- Media Access ---
function startLocalStream() {
    navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
    })
    .then((stream) => {
        localStream = stream;
        localVideo.srcObject = stream;
        
        // Setup toggle buttons state
        updateMediaControlUI();

        // Notify server
        socket.emit('new-user', { id: socket.id });

        // Socket Listeners for WebRTC
        setupSocketListeners();
    })
    .catch((error) => {
        console.error('Error accessing media devices:', error);
        alert("Camera/Microphone access denied.");
    });
}

// Call immediately on load
startLocalStream();

// --- Socket Events ---
function setupSocketListeners() {
    socket.on('offer', ({ offer, senderId }) => handleOffer(offer, senderId));
    socket.on('answer', ({ answer, senderId }) => handleAnswer(answer, senderId));
    socket.on('candidate', ({ candidate, senderId }) => handleCandidate(candidate, senderId));
    
    socket.on('participant-disconnected', ({ socketId }) => {
        console.log(`Participant disconnected: ${socketId}`);
        closeConnection(socketId);
    });
}

// Handle user list updates
socket.on('user-list', (users) => {
  const userList = document.getElementById('userList');
  const noUsersMsg = document.getElementById('noUsersMsg');
  userList.innerHTML = ''; 

  const others = users.filter(user => user.id !== socket.id);
  
  if(others.length === 0) {
      noUsersMsg.style.display = 'block';
  } else {
      noUsersMsg.style.display = 'none';
      others.forEach((user) => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            <span><i class="fa-regular fa-user"></i> ${user.name}</span>
        `;
        const callButton = document.createElement('button');
        callButton.className = 'call-btn-small';
        callButton.textContent = 'Call';
        callButton.onclick = () => initiateCall(user.id);
        
        listItem.appendChild(callButton);
        userList.appendChild(listItem);
      });
  }
});

// Handle incoming call popup
socket.on('incoming-call', ({ from, name }) => {
  const popup = document.getElementById('incomingCallPopup');
  const popupCallerId = document.getElementById('popupCallerId');
  const acceptButton = document.getElementById('acceptButton');
  const rejectButton = document.getElementById('rejectButton');

  // Trigger external device vibration/signal
  axios.get('http://192.168.82.196/incomingCall')
    .then(response => console.log('Signal sent for pcad', response.data))
    .catch(error => console.error('Error sending vibration request:', error));

  popup.style.display = 'flex';
  popupCallerId.textContent = `${name}`;

  acceptButton.onclick = () => acceptCall(from);
  rejectButton.onclick = () => rejectCall(from);
});

// --- Call Logic ---

function initiateCall(targetId) {
  socket.emit('call-initiate', { targetId });
  endCallBtn.style.display = 'flex'; // Show end call button
}

function acceptCall(callerId) {
  document.getElementById('incomingCallPopup').style.display = 'none';
  socket.emit('call-accept', { from: callerId });
  endCallBtn.style.display = 'flex';
  createPeerConnection(callerId);
}

function rejectCall(callerId) {
  document.getElementById('incomingCallPopup').style.display = 'none';
  socket.emit('call-reject', { from: callerId });
}

// --- WebRTC Core ---

function createPeerConnection(socketId) {
  const peerConnection = setupPeerConnection(socketId);
  peerConnections[socketId] = peerConnection;

  peerConnection
    .createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    .then((offer) => peerConnection.setLocalDescription(offer))
    .then(() => socket.emit('offer', { offer: peerConnection.localDescription, receiverId: socketId }))
    .catch((error) => console.error('Error creating peer connection:', error));
}

function setupPeerConnection(socketId) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  if(localStream) {
      localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  // --- CHANGED FOR GRID SUPPORT ---
  peerConnection.ontrack = (event) => {
    // Check if video element already exists for this user
    let remoteVideoContainer = document.getElementById(`user-container-${socketId}`);
    
    if (!remoteVideoContainer) {
        remoteVideoContainer = document.createElement('div');
        remoteVideoContainer.id = `user-container-${socketId}`;
        remoteVideoContainer.className = 'video-card';
        
        const videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.id = `remote-video-${socketId}`;
        
        // Add label (optional, name requires mapping ID to name which might need extra logic)
        const label = document.createElement('div');
        label.className = 'user-label';
        label.innerText = `User ${socketId.substr(0,4)}`; 
        
        remoteVideoContainer.appendChild(videoEl);
        remoteVideoContainer.appendChild(label);
        videoGrid.appendChild(remoteVideoContainer);
    }
    
    const videoElement = remoteVideoContainer.querySelector('video');
    videoElement.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('candidate', { candidate: event.candidate, receiverId: socketId });
    }
  };

  return peerConnection;
}

function handleOffer(offer, senderId) {
  const peerConnection = setupPeerConnection(senderId);
  peerConnections[senderId] = peerConnection;

  peerConnection
    .setRemoteDescription(new RTCSessionDescription(offer))
    .then(() => peerConnection.createAnswer())
    .then((answer) => peerConnection.setLocalDescription(answer))
    .then(() => socket.emit('answer', { answer: peerConnection.localDescription, receiverId: senderId }))
    .catch((error) => console.error('Error handling offer:', error));
}

function handleAnswer(answer, senderId) {
  if (peerConnections[senderId]) {
      peerConnections[senderId].setRemoteDescription(new RTCSessionDescription(answer))
        .catch((error) => console.error('Error setting remote description:', error));
  }
}

function handleCandidate(candidate, senderId) {
  if (peerConnections[senderId]) {
      peerConnections[senderId].addIceCandidate(new RTCIceCandidate(candidate))
        .catch((error) => console.error('Error adding ICE candidate:', error));
  }
}

// --- Cleanup ---

function closeConnection(socketId) {
    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
        delete peerConnections[socketId];
    }
    // Remove from Grid
    const element = document.getElementById(`user-container-${socketId}`);
    if (element) element.remove();
}

endCallBtn.addEventListener('click', () => {
  // Stop all local tracks
  if(localStream) {
      localStream.getTracks().forEach((track) => track.stop());
  }

  // Close all peer connections
  Object.keys(peerConnections).forEach((id) => closeConnection(id));
  
  // Hide End Button
  endCallBtn.style.display = 'none';

  // Restart Local Stream (Ready for next call)
  startLocalStream();
});

// --- UI Interactions (Drag & Toggles) ---

// 1. Toggle Mic
btnMic.addEventListener('click', () => {
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        const enabled = !audioTracks[0].enabled;
        audioTracks[0].enabled = enabled;
        updateMediaControlUI();
    }
});

// 2. Toggle Cam
btnCam.addEventListener('click', () => {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
        const enabled = !videoTracks[0].enabled;
        videoTracks[0].enabled = enabled;
        updateMediaControlUI();
    }
});

function updateMediaControlUI() {
    if (!localStream) return;
    const audioEnabled = localStream.getAudioTracks()[0]?.enabled;
    const videoEnabled = localStream.getVideoTracks()[0]?.enabled;

    // Mic UI
    if (audioEnabled) {
        btnMic.classList.remove('off');
        btnMic.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    } else {
        btnMic.classList.add('off');
        btnMic.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    }

    // Cam UI
    if (videoEnabled) {
        btnCam.classList.remove('off');
        btnCam.innerHTML = '<i class="fa-solid fa-video"></i>';
    } else {
        btnCam.classList.add('off');
        btnCam.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
    }
}

// 3. Robust Drag Logic (Touch + Mouse)
const dragItem = document.getElementById('localVideoContainer');
let active = false;
let currentX, currentY, initialX, initialY;
let xOffset = 0, yOffset = 0;

dragItem.addEventListener("touchstart", dragStart, false);
dragItem.addEventListener("touchend", dragEnd, false);
dragItem.addEventListener("touchmove", drag, false);
dragItem.addEventListener("mousedown", dragStart, false);
document.addEventListener("mouseup", dragEnd, false);
document.addEventListener("mousemove", drag, false);

function dragStart(e) {
  if (e.type === "touchstart") {
    initialX = e.touches[0].clientX - xOffset;
    initialY = e.touches[0].clientY - yOffset;
  } else {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
  }
  if (e.target === dragItem || dragItem.contains(e.target)) {
    active = true;
  }
}

function dragEnd(e) {
  initialX = currentX;
  initialY = currentY;
  active = false;
}

function drag(e) {
  if (active) {
    e.preventDefault();
    if (e.type === "touchmove") {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }
    xOffset = currentX;
    yOffset = currentY;
    setTranslate(currentX, currentY, dragItem);
  }
}

function setTranslate(xPos, yPos, el) {
  el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
}