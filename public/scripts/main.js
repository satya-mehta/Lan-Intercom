const socket = io();
const peerConnections = {}; // Map<socketId, RTCPeerConnection>
let localStream;
let currentSessionId = null;

// DOM Elements
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('video-grid');
const endCallBtn = document.getElementById('endCallButton');
const btnMic = document.getElementById('btn-mic');
const btnCam = document.getElementById('btn-camera');
const emptyGridMsg = document.getElementById('empty-grid-msg');

// --- Helper: Cookies ---
function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

// --- 1. Initialization ---
let userName = getCookie('userName');
if (!userName) {
  userName = prompt('Enter your name:');
  if (userName) setCookie('userName', userName, 365);
}

// Triggered on connection
socket.on('connect', () => {
    console.log("Connected to server");
    if (userName) {
        socket.emit('register-device', { name: userName });
    }
});

// --- 2. Media Access ---
async function startLocalStream() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 30 } },
            audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
        });
        localStream = stream;
        localVideo.srcObject = stream;
        updateMediaControlUI();
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert("Camera/Microphone access denied.");
    }
}

// Start media immediately
startLocalStream();

// --- 3. Socket Events (Signaling) ---

// A. User List
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
            listItem.innerHTML = `<span><i class="fa-regular fa-user"></i> ${user.name}</span>`;
            
            const callButton = document.createElement('button');
            callButton.className = 'call-btn-small';
            callButton.textContent = 'Call';
            callButton.onclick = () => startSessionAndInvite(user.id);
            
            listItem.appendChild(callButton);
            userList.appendChild(listItem);
        });
    }
});

// B. Invitations
socket.on('session-invite', ({ from, sessionId }) => {
    if (currentSessionId) return; // Already in a call

    // Trigger external device vibration/signal
    axios.get('http://192.168.82.196/incomingCall')
        .then(response => console.log('Signal sent', response.data))
        .catch(e => console.error('Signal error', e));

    showIncomingCallPopup(from, sessionId);
});

socket.on('invite-rejected', ({ userId }) => {
    alert(`User refused the invitation.`);
    // We stay in the room alone
});

// C. Negotiation Trigger (Server Controlled)
socket.on('create-offer', async ({ targetId }) => {
    console.log("Server requested to create offer for:", targetId);
    await createPeerConnection(targetId, true); // true = we are making offer
});

// D. WebRTC Signals
socket.on('offer', async ({ senderId, offer }) => {
    console.log("Received offer from:", senderId);
    await createPeerConnection(senderId, false); // Create peer before setting remote desc
    await handleOffer(senderId, offer);
});

socket.on('answer', async ({ senderId, answer }) => {
    console.log("Received answer from:", senderId);
    await handleAnswer(senderId, answer);
});

socket.on('candidate', async ({ senderId, candidate }) => {
    await handleCandidate(senderId, candidate);
});

// E. Disconnections (THIS ANSWERS YOUR QUESTION)
socket.on('participant-left', ({ userId }) => {
    console.log(`User ${userId} left the session.`);
    cleanupPeer(userId);
});

socket.on('force-peer-close', ({ userId }) => {
    console.log(`Force closing peer: ${userId}`);
    cleanupPeer(userId);
});


// --- 4. Call Logic (Actions) ---

function startSessionAndInvite(targetId) {
    if (currentSessionId) return; 
    
    const newSessionId = `room-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    currentSessionId = newSessionId;
    
    socket.emit('join-session', { sessionId: newSessionId });
    socket.emit('invite-to-session', { targetId: targetId, sessionId: newSessionId });
    
    endCallBtn.style.display = 'flex';
    emptyGridMsg.style.display = 'block'; // Show "Waiting" icon
    emptyGridMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size: 48px; margin-bottom:10px;"></i><p>Calling...</p>';
}

function showIncomingCallPopup(callerId, sessionId) {
    const popup = document.getElementById('incomingCallPopup');
    const popupCallerId = document.getElementById('popupCallerId');
    const acceptButton = document.getElementById('acceptButton');
    const rejectButton = document.getElementById('rejectButton');

    popup.style.display = 'flex';
    popupCallerId.textContent = `User ID: ${callerId.substr(0,5)}...`;

    rejectButton.onclick = () => {
        popup.style.display = 'none';
        socket.emit('reject-invite', { targetId: callerId });
    };

    acceptButton.onclick = () => {
        popup.style.display = 'none';
        currentSessionId = sessionId;
        socket.emit('join-session', { sessionId: sessionId });
        endCallBtn.style.display = 'flex';
        emptyGridMsg.style.display = 'block';
        emptyGridMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size: 48px;"></i><p>Connecting...</p>';
    };
}

function leaveSession() {
    if (currentSessionId) {
        socket.emit('leave-session', { sessionId: currentSessionId });
        currentSessionId = null;
    }
    
    // Close all connections
    Object.keys(peerConnections).forEach(id => cleanupPeer(id));
    
    endCallBtn.style.display = 'none';
    emptyGridMsg.style.display = 'none'; // Hide the waiting message
}

endCallBtn.addEventListener('click', leaveSession);


// --- 5. WebRTC Core ---

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

async function createPeerConnection(targetId, isOfferer) {
    if (peerConnections[targetId]) return peerConnections[targetId];

    const pc = new RTCPeerConnection(iceServers);
    peerConnections[targetId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        addRemoteVideo(targetId, stream);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', { receiverId: targetId, candidate: event.candidate });
        }
    };

    if (isOfferer) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { receiverId: targetId, offer: pc.localDescription });
        } catch (e) {
            console.error("Error creating offer:", e);
        }
    }

    return pc;
}

async function handleOffer(senderId, offer) {
    const pc = peerConnections[senderId]; 
    if(!pc) return; // Should be created by createPeerConnection before this is called
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { receiverId: senderId, answer: pc.localDescription });
}

async function handleAnswer(senderId, answer) {
    const pc = peerConnections[senderId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

async function handleCandidate(senderId, candidate) {
    const pc = peerConnections[senderId];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    }
}


// --- 6. Grid & UI Logic ---

function addRemoteVideo(userId, stream) {
    // Hide the "Empty/Waiting" message because we found a friend
    emptyGridMsg.style.display = 'none';

    let card = document.getElementById(`user-container-${userId}`);
    if (card) return;

    card = document.createElement('div');
    card.id = `user-container-${userId}`;
    card.className = 'video-card';
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'user-label';
    label.innerText = `User ${userId.substr(0,4)}`;

    card.appendChild(video);
    card.appendChild(label);
    videoGrid.appendChild(card);
}

function cleanupPeer(userId) {
    // 1. Close WebRTC
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }

    // 2. Remove Video UI
    const card = document.getElementById(`user-container-${userId}`);
    if (card) card.remove();

    // 3. Check if anyone is left. If not, show "Waiting..." or handle end of call
    const remainingVideos = document.querySelectorAll('.video-card');
    if (remainingVideos.length === 0) {
        // If we are still in a session, show waiting. 
        if(currentSessionId) {
             emptyGridMsg.style.display = 'block';
             emptyGridMsg.innerHTML = '<i class="fa-solid fa-user-clock" style="font-size: 48px; opacity: 0.5;"></i><p>Waiting for others...</p>';
        } else {
             emptyGridMsg.style.display = 'none';
        }
    }
}


// --- 7. Local Interactions ---

btnMic.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateMediaControlUI();
    }
});

btnCam.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateMediaControlUI();
    }
});

function updateMediaControlUI() {
    if (!localStream) return;
    const audioEnabled = localStream.getAudioTracks()[0]?.enabled;
    const videoEnabled = localStream.getVideoTracks()[0]?.enabled;

    btnMic.classList.toggle('off', !audioEnabled);
    btnMic.innerHTML = audioEnabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
    
    btnCam.classList.toggle('off', !videoEnabled);
    btnCam.innerHTML = videoEnabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
}

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
  if (e.target === dragItem || dragItem.contains(e.target)) active = true;
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