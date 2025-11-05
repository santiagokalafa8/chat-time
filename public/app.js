let socket;
let localStream;
let peerConnection;
let partnerId = null;
let partnerUserIdGlobal = null;
let autoStartCall = false;

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');
const endButton = document.getElementById('endButton');
const nextButton = document.getElementById('nextButton');
const saveFavoriteButton = document.getElementById('saveFavoriteButton');
const favoritesList = document.getElementById('favoritesList');

function actualizarBotonAuth() {
  const container = document.getElementById('authButtonContainer');
  const registerButton = document.querySelector('.btn-registrer'); // botón "Registrarse"
  const token = localStorage.getItem('token');

  if (token) {
    // Mostrar solo el botón "Cerrar sesión"
    container.innerHTML = `
      <button class="btn btn-outline-light ms-3" onclick="logout()">Cerrar sesión</button>
    `;

    // Ocultar el botón "Registrarse"
    if (registerButton) {
      registerButton.style.display = 'none';
    }
  } else {
    // Mostrar el botón "Iniciar sesión"
    container.innerHTML = `
      <button class="btn btn-violet ms-3" data-bs-toggle="modal" data-bs-target="#authModal">
        Iniciar sesión
      </button>
    `;

    // Volver a mostrar el botón "Registrarse"
    if (registerButton) {
      registerButton.style.display = 'inline-block';
    }
  }
}


function logout() {
  localStorage.removeItem('token');
  location.reload();
  actualizarBotonAuth(); // actualiza el botón sin recargar
}

//window.addEventListener('DOMContentLoaded', actualizarBotonAuth);

function connectSocket(token) {
  socket = io({ auth: { token } });

  socket.on('paired', async (data) => {
    partnerId = data.partnerId;
    partnerUserIdGlobal = data.partnerUserId;

    console.log('✅ Emparejado con socket:', partnerId);
    console.log('✅ ID del usuario emparejado:', partnerUserIdGlobal);

    if (!partnerUserIdGlobal) {
      console.error("❌ partnerUserIdGlobal no está definido");
    }

    saveFavoriteButton.style.display = 'inline-block';
    saveFavoriteButton.onclick = () => guardarFavorito(partnerUserIdGlobal);

    if (autoStartCall) createPeerConnection(true);
  });

  socket.on('start-direct-call', () => {
    createPeerConnection(true);
    startButton.disabled = true;
    endButton.disabled = false;
    nextButton.disabled = false;
    autoStartCall = false; // Solo para llamadas aleatorias, no afecta la directa
  });

  socket.on('offer', async (offer, from) => {
    partnerId = from;
    await createPeerConnection(false);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer, partnerId);
  });

  socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async (candidate) => {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error al agregar ICE:', e);
    }
  });

  socket.on('partner-disconnected', () => {
    cleanupCall();
    partnerId = null;
    partnerUserIdGlobal = null;
    startButton.disabled = false;
    endButton.disabled = true;
    nextButton.disabled = true;
    autoStartCall = false;
  });
  socket.on('call-failed', (data) => {
    if (data.reason === 'offline') {
      alert('El usuario favorito no está en línea.');
    } else if (data.reason === 'busy') {
      alert('El usuario favorito ya está en una llamada.');
    }
    startButton.disabled = false;
    endButton.disabled = true;
    nextButton.disabled = true;
  });
}

async function login() {
  const email = document.getElementById('correo_electronico').value.trim();
  const password = document.getElementById('contrasenia').value.trim();
  if (!email || !password) return alert("Completá ambos campos.");

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      location.reload();
    } else {
      alert(data.error || "Credenciales incorrectas.");
    }
  } catch (err) {
    console.error("Error en login:", err);
    alert("Hubo un error al iniciar sesión.");
  }
}

async function register() {
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-contrasenia').value.trim();
  const nickname = document.getElementById('nickname').value.trim();

  const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

  if (!email || !password || !nickname) {
    return alert("Completá todos los campos.");
  }

  if (!gmailRegex.test(email)) {
    return alert("Ingresá un correo válido de Gmail (ej: usuario@gmail.com)");
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nickname })
    });
    const data = await res.json();
    if (data.success) {
      alert("Registrado correctamente. Ahora iniciá sesión.");
    } else {
      alert(data.error || "El correo ya está registrado.");
    }
  } catch (err) {
    console.error("Error en registro:", err);
    alert("Hubo un error al registrarse.");
  }
}

async function startMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.error("Error al acceder a la cámara:", err);
    alert("No se pudo acceder a la cámara o micrófono.");
  }
}

startButton.onclick = () => {
  if (partnerId) createPeerConnection(true);
  startButton.disabled = true;
  endButton.disabled = false;
  nextButton.disabled = false;
  autoStartCall = false;
};

endButton.onclick = () => {
  endCall();
  autoStartCall = false;
};

nextButton.onclick = () => {
  endCall();
  autoStartCall = true;
  socket.emit('next-call');
};

function createPeerConnection(isInitiator) {
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', candidate, partnerId);
  };

  peerConnection.ontrack = ({ streams }) => {
    remoteVideo.srcObject = streams[0];
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  if (isInitiator) {
    peerConnection.createOffer()
      .then(offer => peerConnection.setLocalDescription(offer))
      .then(() => socket.emit('offer', peerConnection.localDescription, partnerId));
  }
}

async function endCall() {
  if (peerConnection) {
    peerConnection.getSenders().forEach(sender => sender.track?.stop());
    peerConnection.close();
    peerConnection = null;
  }

  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    await startMedia();
  }

  if (partnerId) {
    socket.emit('end-call', partnerId);
  }

  partnerId = null;
  partnerUserIdGlobal = null;
  startButton.disabled = false;
  endButton.disabled = true;
  nextButton.disabled = true;
  autoStartCall = false;
}

function callFavorite(targetUserId) {
  const token = localStorage.getItem('token');
  if (!token) return alert("Debes iniciar sesión para llamar.");

  if (peerConnection) return alert("Ya estás en una llamada. Finalizá la actual primero.");

  if (!socket) {
    alert("Conectando al servicio, intentá de nuevo.");
    const token = localStorage.getItem('token');
    connectSocket(token);
    return;
  }
  
  // 1. Deshabilitar botones de inicio de llamada aleatoria
  startButton.disabled = true;
  
  // 2. Enviar señal de llamada directa
  socket.emit('direct-call', targetUserId);
  console.log(`📞 Intentando llamar a User ID: ${targetUserId}`);

  // Los botones de End/Next se habilitan cuando se recibe 'paired' o 'start-direct-call'
}

async function cleanupCall() {
  if (peerConnection) {
    peerConnection.getSenders().forEach(sender => sender.track?.stop());
    peerConnection.close();
    peerConnection = null;
  }

  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    await startMedia();
  }

  partnerId = null;
  partnerUserIdGlobal = null;
  startButton.disabled = false;
  endButton.disabled = true;
  nextButton.disabled = true;
  autoStartCall = false;

  saveFavoriteButton.style.display = 'none';
}

async function guardarFavorito(favoriteId) {
  const token = localStorage.getItem('token');
  if (!token) return alert("Necesitás estar logueado.");

  if (!favoriteId) {
    console.error("❌ favoriteId está vacío o undefined");
    return alert("No se pudo guardar el favorito: ID inválido.");
  }

  console.log('📤 Enviando favorito con ID:', favoriteId);

  try {
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `${token}`
      },
      body: JSON.stringify({ favoriteId })
    });

    const data = await res.json();
    if (data.success) {
      alert("Conexión guardada como favorita 💖");
      
      // ⬅️ ¡ESTA ES LA LÍNEA QUE LO HACE INSTANTÁNEO!
      cargarFavoritos(); 
      
    } else {
      alert(data.error || "No se pudo guardar el favorito.");
    }
  } catch (err) {
    console.error("Error al guardar favorito:", err);
    alert("Hubo un error al guardar el favorito.");
  }

  saveFavoriteButton.style.display = 'none';
}





async function eliminarFavorito(favoriteId) {
    const token = localStorage.getItem('token');
    if (!token) return alert('Debes iniciar sesión para eliminar favoritos.');

    const confirmed = confirm('¿Estás seguro de que quieres eliminar este usuario de tus favoritos?');
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/favorites/${favoriteId}`, {
            method: 'DELETE',
            headers: { 'Authorization': token },
        });

        if (response.ok) {
            alert('Favorito eliminado con éxito.');
            cargarFavoritos(); // Recarga la lista
        } else {
            const errorData = await response.json();
            alert('Error al eliminar: ' + (errorData.error || 'Desconocido'));
        }
    } catch (error) {
        console.error('Error de red al eliminar favorito:', error);
        alert('Error de conexión al eliminar favorito.');
    }
}

async function cargarFavoritos() {
    const token = localStorage.getItem('token');
    favoritesList.innerHTML = ''; // Limpiar la lista actual

    if (!token) {
        favoritesList.innerHTML = '<li class="list-group-item bg-dark text-white-50 border-secondary">Inicia sesión para ver tus favoritos.</li>';
        return;
    }

    try {
        const response = await fetch('/api/favorites', {
            headers: { 'Authorization': token },
        });

        const favoritos = await response.json();
        const favoriteIds = favoritos.map(fav => fav.id); // ⬅️ Obtener solo los IDs

        if (favoritos.length === 0) {
            favoritesList.innerHTML = '<li class="list-group-item bg-dark text-white-50 border-secondary">Aún no has guardado ningún favorito.</li>';
            return;
        }

        // Renderizar la lista inicialmente
        favoritos.forEach(fav => {
            const li = document.createElement('li');
            li.id = `fav-item-${fav.id}`; // ⬅️ Asignar ID para futura actualización
            li.className = 'list-group-item d-flex justify-content-between align-items-center bg-dark text-white border-secondary';
            
            const date = new Date(fav.saved_at).toLocaleDateString('es-ES'); 

li.innerHTML = `
  <div class="d-flex align-items-center justify-content-between w-100">
    <!-- 🧍 Izquierda: usuario y estado -->
    <div class="d-flex align-items-center flex-grow-1">
      <i class="fa-solid fa-user-tag me-2 text-info"></i>
      <strong>${fav.nickname}</strong>
      <span id="status-${fav.id}" class="badge bg-danger ms-3">Desconectado</span>
    </div>

    <!-- 📞🗑️ Derecha: botones -->
    <div class="d-flex align-items-center ms-auto">
      <button class="btn btn-success btn-sm me-2" onclick="callFavorite(${fav.id})" id="call-btn-${fav.id}" disabled>
        <i class="fa-solid fa-phone"></i>
      </button>
      <button class="btn btn-danger btn-sm" onclick="eliminarFavorito(${fav.id})">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  </div>
`;

            favoritesList.appendChild(li);
        });
        
        // ⬅️ NUEVO: Obtener el estado y actualizar la lista
        await updateFavoriteStatus(favoriteIds, token);


    } catch (error) {
        console.error('Error de red al cargar favoritos:', error);
        favoritesList.innerHTML = '<li class="list-group-item bg-dark text-danger border-secondary">Error al cargar favoritos.</li>';
    }
}

async function updateFavoriteStatus(favoriteIds, token) {
    try {
        const res = await fetch('/api/favorites/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify({ favoriteIds })
        });
        
        const statusMap = await res.json(); // Ejemplo: { '1': 'online', '5': 'offline' }

        favoriteIds.forEach(id => {
            const status = statusMap[id] || 'offline';
            const statusElement = document.getElementById(`status-${id}`);
            const callButton = document.getElementById(`call-btn-${id}`);

            if (statusElement) {
                if (status === 'online') {
                    statusElement.className = 'badge bg-success me-2';
                    statusElement.textContent = 'En línea';
                    callButton.disabled = false; // Habilitar el botón
                } else {
                    statusElement.className = 'badge bg-danger me-2';
                    statusElement.textContent = 'Desconectado';
                    callButton.disabled = true; // Deshabilitar el botón
                }
            }
        });
    } catch (error) {
        console.error('Error al obtener estado de favoritos:', error);
    }
}


window.onload = () => {
  actualizarBotonAuth();
  const token = localStorage.getItem('token');
  if (!token) {
  } else {
    connectSocket(token);
    startMedia();
    cargarFavoritos();
  }
};
