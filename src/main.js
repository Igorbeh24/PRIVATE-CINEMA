import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

import { supabase } from './lib/supabase.js';

import './style.css';



// ======================================================

// CONFIGURAÇÕES GERAIS

// ======================================================



const MODEL_PATH = '/models/Cine.glb';



const CAMERA_START = new THREE.Vector3(6.55, 2.65, 0);

const LOOK_AT_START = new THREE.Vector3(-4.42, 3.88, 0);



const SCREEN_NAME = 'Screen';

const SCREEN_CENTER = new THREE.Vector3(-4.415, 3.8777, 0);

const SCREEN_WIDTH = 12.65;

const SCREEN_HEIGHT = 7.0;



// ======================================================

// CONFIGURAÇÃO DAS CADEIRAS

// ======================================================



const SEAT_CONFIG = {

  total: 12,



  // Uma única fileira

  columns: 12,



  // Posição da primeira cadeira

  startX: 6.6,

  startY: 2.65,

  startZ: -3.15,



  // Distância entre cada cadeira

  columnSpacing: 1.35,



  showNumbers: true,

  markerHeight: 0.8,

  markerSize: 0.38

};



// ======================================================

// ESTADO GLOBAL

// ======================================================



let scene;

let camera;

let renderer;

let cssRenderer;

let controls;



let videoElement;

let videoTexture;

let videoTextureSource;

let screenMesh;



let currentRoom = null;

let currentUser = null;

let currentSeat = null;

let isHost = false;

let isSeeking = false;

let isApplyingRemotePlayback = false;



let localObjectUrl = null;

let remoteVideoUrl = null;

let currentVideoUrl = null;



let playbackDebounceTimer = null;

let lastPlaybackPublish = 0;

let lastRemotePlaybackUpdate = 0;



let heartbeatTimer = null;

let roomRefreshTimer = null;

let presenceChannel = null;

let roomChannel = null;

let voiceChannel = null;



let peerConnections = new Map();

let localStream = null;



let seatMarkers = [];

let seatPositions = [];



let yaw = 0;

let pitch = 0;

let isPointerLocked = false;



const $ = selector => document.querySelector(selector);

const a$ = selector => document.querySelector(selector);



// ======================================================

// ELEMENTOS DA INTERFACE

// ======================================================



const app = $('#app');

const sceneContainer = $('#scene');

const css3dContainer = $('#css3d');

const loadingElement = $('#loading');

const welcomeElement = $('#welcome');

const hintElement = $('#hint');

const playerPanel = $('#playerPanel');

const playPauseBtn = $('#playPauseBtn');

const seekBar = $('#seekBar');



// ======================================================

// INICIALIZAÇÃO

// ======================================================



async function init() {

  try {

    scene = new THREE.Scene();

    scene.background = new THREE.Color(0x000000);



    camera = new THREE.PerspectiveCamera(

      65,

      window.innerWidth / window.innerHeight,

      0.1,

      1000

    );



    camera.position.copy(CAMERA_START);

    camera.lookAt(LOOK_AT_START);



    yaw = Math.atan2(

      LOOK_AT_START.x - CAMERA_START.x,

      LOOK_AT_START.z - CAMERA_START.z

    );



    pitch = Math.atan2(

      LOOK_AT_START.y - CAMERA_START.y,

      Math.sqrt(

        Math.pow(LOOK_AT_START.x - CAMERA_START.x, 2) +

        Math.pow(LOOK_AT_START.z - CAMERA_START.z, 2)

      )

    );



    renderer = new THREE.WebGLRenderer({

      antialias: true,

      alpha: false

    });



    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    renderer.setSize(window.innerWidth, window.innerHeight);

    renderer.outputColorSpace = THREE.SRGBColorSpace;



    sceneContainer.appendChild(renderer.domElement);



    cssRenderer = new CSS3DRenderer();

    cssRenderer.setSize(window.innerWidth, window.innerHeight);

    css3dContainer.appendChild(cssRenderer.domElement);



    setupLighting();

    setupControls();

    setupEvents();



    await loadCinemaModel();



    createVideoScreen();

    createSeatMarkers();



    if (loadingElement) {

      loadingElement.style.display = 'none';

    }



    animate();



  } catch (error) {

    console.error('Erro ao inicializar o cinema:', error);

    showMessage('Não foi possível carregar o cinema.');

  }

}



// ======================================================

// ILUMINAÇÃO

// ======================================================



function setupLighting() {

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);

  scene.add(ambientLight);



  const directionalLight = new THREE.DirectionalLight(0xffffff, 2);

  directionalLight.position.set(5, 10, 5);

  scene.add(directionalLight);



  const pointLight = new THREE.PointLight(0xffffff, 2, 30);

  pointLight.position.set(0, 5, 0);

  scene.add(pointLight);

}



// ======================================================

// CONTROLES DA CÂMERA

// ======================================================



function setupControls() {

  renderer.domElement.addEventListener('click', () => {

    if (!isPointerLocked) {

      renderer.domElement.requestPointerLock?.();

    }

  });



  document.addEventListener('pointerlockchange', () => {

    isPointerLocked = document.pointerLockElement === renderer.domElement;

  });



  document.addEventListener('mousemove', event => {

    if (!isPointerLocked) return;



    yaw -= event.movementX * 0.002;

    pitch -= event.movementY * 0.002;



    pitch = Math.max(-0.5, Math.min(0.5, pitch));



    updateCameraRotation();

  });

}



function updateCameraRotation() {

  const direction = new THREE.Vector3(

    Math.sin(yaw) * Math.cos(pitch),

    Math.sin(pitch),

    Math.cos(yaw) * Math.cos(pitch)

  );



  camera.lookAt(

    camera.position.clone().add(direction)

  );

}



// ======================================================

// CARREGAMENTO DO MODELO 3D

// ======================================================



async function loadCinemaModel() {

  const loader = new GLTFLoader();



  const gltf = await loader.loadAsync(MODEL_PATH);



  const model = gltf.scene;



  model.traverse(object => {

    if (!object.isMesh) return;



    object.castShadow = true;

    object.receiveShadow = true;



    if (object.name === SCREEN_NAME) {

      screenMesh = object;

    }



    if (object.material) {

      object.material.needsUpdate = true;

    }

  });



  scene.add(model);

}



// ======================================================

// TELA DE VÍDEO

// ======================================================



function createVideoScreen() {

  videoElement = document.createElement('video');



  videoElement.crossOrigin = 'anonymous';

  videoElement.playsInline = true;

  videoElement.preload = 'auto';

  videoElement.controls = false;

  videoElement.loop = false;



  videoElement.addEventListener('loadedmetadata', updatePlaybackUI);

  videoElement.addEventListener('timeupdate', updatePlaybackUI);

  videoElement.addEventListener('durationchange', updatePlaybackUI);

  videoElement.addEventListener('play', updatePlaybackUI);

  videoElement.addEventListener('pause', updatePlaybackUI);



  videoTexture = new THREE.VideoTexture(videoElement);

  videoTexture.colorSpace = THREE.SRGBColorSpace;



  const geometry = new THREE.PlaneGeometry(

    SCREEN_WIDTH,

    SCREEN_HEIGHT

  );



  const material = new THREE.MeshBasicMaterial({

    map: videoTexture,

    side: THREE.DoubleSide

  });



  const screen = new THREE.Mesh(geometry, material);



  screen.position.copy(SCREEN_CENTER);



  screen.rotation.y = -Math.PI / 2;



  scene.add(screen);



  if (screenMesh) {

    screenMesh.visible = false;

  }



  videoElement.addEventListener('error', () => {

    console.error('Erro no vídeo:', videoElement.error);

    showMessage('Não foi possível carregar este vídeo.');

  });

}



// ======================================================

// CARREGAMENTO DE VÍDEO

// ======================================================



function isDirectVideoUrl(url) {

  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);

}



function getVideoType(url) {

  if (/\.(mp4)(\?.*)?$/i.test(url)) return 'video/mp4';

  if (/\.(webm)(\?.*)?$/i.test(url)) return 'video/webm';

  if (/\.(ogg)(\?.*)?$/i.test(url)) return 'video/ogg';

  return '';

}



function getEmbedUrl(url) {

  try {

    const parsed = new URL(url);



    if (parsed.hostname.includes('youtube.com')) {

      const id = parsed.searchParams.get('v');

      if (id) {

        return `https://www.youtube.com/embed/${id}?autoplay=1`;

      }

    }



    if (parsed.hostname.includes('youtu.be')) {

      const id = parsed.pathname.replace('/', '');

      if (id) {

        return `https://www.youtube.com/embed/${id}?autoplay=1`;

      }

    }



    if (parsed.hostname.includes('vimeo.com')) {

      const id = parsed.pathname.split('/').filter(Boolean).pop();

      if (id) {

        return `https://player.vimeo.com/video/${id}?autoplay=1`;

      }

    }



  } catch (error) {

    console.error(error);

  }



  return null;

}



async function loadVideoLink(raw, fromRemote = false) {

  const value = String(raw || '').trim();



  if (!value) return;



  let parsed;



  try {

    parsed = new URL(value);

  } catch {

    showMessage('Link inválido.');

    return;

  }



  if (!['http:', 'https:'].includes(parsed.protocol)) {

    showMessage('Use um link HTTP ou HTTPS.');

    return;

  }



  const directVideo = isDirectVideoUrl(value);



  const embedUrl = getEmbedUrl(value);



  if (!directVideo && !embedUrl) {

    showMessage('Formato de vídeo não reconhecido.');

    return;

  }



  if (!fromRemote && currentRoom && !isHost) {

    showMessage('Somente o anfitrião pode trocar o vídeo.');

    return;

  }



  if (directVideo) {

    if (localObjectUrl) {

      URL.revokeObjectURL(localObjectUrl);

      localObjectUrl = null;

    }



    videoElement.pause();

    videoElement.removeAttribute('src');

    videoElement.load();



    videoElement.src = value;

    currentVideoUrl = value;



    videoElement.load();



    try {

      await videoElement.play();

    } catch (error) {

      console.warn('Autoplay bloqueado:', error);

    }



    if (!fromRemote && currentRoom && isHost) {

      await publishPlayback('playing', value, true);

    }



    updatePlaybackUI();

    return;

  }



  // YouTube e Vimeo usam player incorporado.

  // A sincronização de pausa e avanço depende da API específica do provedor.



  currentVideoUrl = value;



  const iframe = document.createElement('iframe');

  iframe.src = embedUrl;

  iframe.allow = 'autoplay; fullscreen; picture-in-picture';

  iframe.allowFullscreen = true;



  const wrapper = $('#videoEmbed');



  if (wrapper) {

    wrapper.innerHTML = '';

    wrapper.appendChild(iframe);

    wrapper.style.display = 'block';

  }



  if (!fromRemote && currentRoom && isHost) {

    await publishPlayback('playing', value, true);

  }

}



// ======================================================

// SINCRONIZAÇÃO DE REPRODUÇÃO

// ======================================================



async function waitForVideoMetadata(video) {

  if (video.readyState >= 1) return;



  await new Promise((resolve, reject) => {

    const timeout = setTimeout(() => {

      cleanup();

      reject(new Error('Tempo esgotado aguardando os metadados do vídeo.'));

    }, 15000);



    function loaded() {

      cleanup();

      resolve();

    }



    function failed() {

      cleanup();

      reject(new Error('Não foi possível carregar os metadados do vídeo.'));

    }



    function cleanup() {

      clearTimeout(timeout);

      video.removeEventListener('loadedmetadata', loaded);

      video.removeEventListener('error', failed);

    }



    video.addEventListener('loadedmetadata', loaded, { once: true });

    video.addEventListener('error', failed, { once: true });

  });

}



async function publishPlayback(status, mediaUrl = undefined, force = false) {

  if (!currentRoom || !isHost || isApplyingRemotePlayback) return;



  const now = Date.now();



  if (!force && now - lastPlaybackPublish < 500) {

    clearTimeout(playbackDebounceTimer);



    playbackDebounceTimer = setTimeout(() => {

      publishPlayback(status, mediaUrl, true);

    }, 550);



    return;

  }



  lastPlaybackPublish = now;



  const position = videoElement && Number.isFinite(videoElement.currentTime)

    ? videoElement.currentTime

    : 0;



  const payload = {

    room_id: currentRoom.id,

    playback_status: status,

    playback_position: position,

    playback_updated_at: new Date().toISOString()

  };



  if (mediaUrl !== undefined) {

    payload.media_url = mediaUrl;

  }



  try {

    const { error } = await supabase.rpc('set_room_playback', {

      p_room_id: currentRoom.id,

      p_status: status,

      p_position: position,

      p_media_url: mediaUrl === undefined ? null : mediaUrl

    });



    if (error) throw error;



    currentRoom.playback_status = status;

    currentRoom.playback_position = position;

    currentRoom.playback_updated_at = payload.playback_updated_at;



    if (mediaUrl !== undefined) {

      currentRoom.media_url = mediaUrl;

    }



  } catch (error) {

    console.error('Erro ao sincronizar reprodução:', error);

  }

}



async function applyRemoteRoomPlayback(room) {

  if (!room || !videoElement) return;



  if (isHost) return;



  const mediaUrl = room.media_url;



  if (!mediaUrl) return;



  try {

    isApplyingRemotePlayback = true;



    if (currentVideoUrl !== mediaUrl) {

      await loadVideoLink(mediaUrl, true);

    }



    if (!isDirectVideoUrl(mediaUrl)) {

      return;

    }



    await waitForVideoMetadata(videoElement);



    let position = Number(room.playback_position || 0);



    if (room.playback_status === 'playing' && room.playback_updated_at) {

      const updatedAt = new Date(room.playback_updated_at).getTime();



      if (Number.isFinite(updatedAt)) {

        const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);

        position += elapsed;

      }

    }



    if (Number.isFinite(videoElement.duration)) {

      position = Math.min(position, videoElement.duration);

    }



    if (Math.abs(videoElement.currentTime - position) > 0.8) {

      videoElement.currentTime = position;

    }



    if (room.playback_status === 'playing') {

      try {

        await videoElement.play();

      } catch (error) {

        console.warn('O navegador bloqueou o autoplay:', error);

      }

    } else {

      videoElement.pause();

    }



    lastRemotePlaybackUpdate = Date.now();



  } catch (error) {

    console.error('applyRemoteRoomPlayback:', error);

  } finally {

    isApplyingRemotePlayback = false;

  }

}



// ======================================================

// ATUALIZAÇÃO DA INTERFACE DO PLAYER

// ======================================================



function updatePlaybackUI() {

  if (!videoElement) return;



  const seek = $('#seekBar');

  const currentTimeLabel = $('#currentTime');

  const durationLabel = $('#duration');



  if (seek) {

    const duration = Number.isFinite(videoElement.duration)

      ? videoElement.duration

      : 0;



    seek.max = String(duration);



    if (!isSeeking) {

      seek.value = String(videoElement.currentTime || 0);

    }



    seek.disabled = !isHost && !!currentRoom;

  }



  if (currentTimeLabel) {

    currentTimeLabel.textContent = formatTime(videoElement.currentTime || 0);

  }



  if (durationLabel) {

    durationLabel.textContent = formatTime(

      Number.isFinite(videoElement.duration) ? videoElement.duration : 0

    );

  }



  if (playPauseBtn) {

    playPauseBtn.textContent = videoElement.paused ? '▶' : 'Ⅱ';

  }

}



function formatTime(seconds) {

  if (!Number.isFinite(seconds)) return '0:00';



  const total = Math.floor(seconds);

  const minutes = Math.floor(total / 60);

  const remainder = total % 60;



  return `${minutes}:${String(remainder).padStart(2, '0')}`;

}



// ======================================================

// EVENTOS DO PLAYER

// ======================================================



function setupPlayerEvents() {

  playPauseBtn?.addEventListener('click', async () => {

    if (!videoElement) return;



    if (videoElement.paused) {

      try {

        await videoElement.play();

      } catch (error) {

        console.warn(error);

      }

    } else {

      videoElement.pause();

    }



    if (isHost) {

      await publishPlayback(

        videoElement.paused ? 'paused' : 'playing',

        undefined,

        true

      );

    }



    updatePlaybackUI();

  });



  a$('#seekBar')?.addEventListener('pointerdown', () => {

    isSeeking = true;

  });



  a$('#seekBar')?.addEventListener('input', event => {

    if (!videoElement || !Number.isFinite(videoElement.duration)) return;



    const nextTime = Number(event.target.value);



    if (Number.isFinite(nextTime)) {

      videoElement.currentTime = Math.max(

        0,

        Math.min(nextTime, videoElement.duration)

      );

    }



    updatePlaybackUI();

  });



  a$('#seekBar')?.addEventListener('change', async () => {

    isSeeking = false;



    if (isHost) {

      await publishPlayback(

        videoElement.paused ? 'paused' : 'playing',

        undefined,

        true

      );

    }



    updatePlaybackUI();

  });



  a$('#seekBar')?.addEventListener('pointerup', () => {

    isSeeking = false;

  });



  a$('#seekBar')?.addEventListener('pointercancel', () => {

    isSeeking = false;

  });



  videoElement?.addEventListener('ended', async () => {

    if (isHost) {

      await publishPlayback('paused', undefined, true);

    }

  });

}



// ======================================================

// SALAS

// ======================================================



async function createRoom() {

  if (!currentUser) {

    showMessage('Entre na sua conta primeiro.');

    return;

  }



  try {

    const { data, error } = await supabase.rpc('create_room');



    if (error) throw error;



    const room = Array.isArray(data) ? data[0] : data;



    if (!room) {

      throw new Error('O Supabase não retornou a sala criada.');

    }



    currentRoom = room;

    isHost = true;



    await enterRoom(room);



  } catch (error) {

    console.error('Erro ao criar sala:', error);

    showMessage(error.message || 'Não foi possível criar a sala.');

  }

}



async function joinRoom(roomCode) {

  if (!currentUser) {

    showMessage('Entre na sua conta primeiro.');

    return;

  }



  try {

    const { data, error } = await supabase.rpc('join_room', {

      p_code: roomCode

    });



    if (error) throw error;



    const room = Array.isArray(data) ? data[0] : data;



    if (!room) {

      throw new Error('Sala não encontrada.');

    }



    currentRoom = room;

    isHost = false;



    await enterRoom(room);



  } catch (error) {

    console.error('Erro ao entrar na sala:', error);

    showMessage(error.message || 'Não foi possível entrar na sala.');

  }

}



async function enterRoom(room) {

  currentRoom = room;



  await refreshRoomState();



  if (currentRoom) {

    await applyRemoteRoomPlayback(currentRoom);

  }



  subscribeToRoom();



  startHeartbeat();



  if (welcomeElement) {

    welcomeElement.style.display = 'none';

  }



  if (playerPanel) {

    playerPanel.style.display = 'block';

  }

}



async function refreshRoomState() {

  if (!currentRoom) return;



  try {

    const { data, error } = await supabase.rpc('get_room_state', {

      p_room_id: currentRoom.id

    });



    if (error) throw error;



    const room = Array.isArray(data) ? data[0] : data;



    if (room) {

      currentRoom = {

        ...currentRoom,

        ...room

      };

    }



  } catch (error) {

    console.error('Erro ao atualizar sala:', error);

  }

}



function subscribeToRoom() {

  if (!currentRoom) return;



  if (roomChannel) {

    supabase.removeChannel(roomChannel);

    roomChannel = null;

  }



  roomChannel = supabase

    .channel(`room-${currentRoom.id}`)

    .on(

      'postgres_changes',

      {

        event: 'UPDATE',

        schema: 'public',

        table: 'rooms',

        filter: `id=eq.${currentRoom.id}`

      },

      async payload => {

        const updatedRoom = payload.new;



        currentRoom = {

          ...currentRoom,

          ...updatedRoom

        };



        if (!isHost) {

          await applyRemoteRoomPlayback(currentRoom);

        }

      }

    )

    .subscribe();

}



// ======================================================

// PRESENÇA E HEARTBEAT

// ======================================================



function startHeartbeat() {

  clearInterval(heartbeatTimer);



  heartbeatTimer = setInterval(async () => {

    if (!currentRoom) return;



    try {

      await supabase.rpc('room_heartbeat', {

        p_room_id: currentRoom.id

      });

    } catch (error) {

      console.warn('Heartbeat:', error);

    }

  }, 15000);

}



// ======================================================

// SAIR DA SALA

// ======================================================



async function leaveRoom() {

  if (!currentRoom) return;



  try {

    await supabase.rpc('leave_room', {

      p_room_id: currentRoom.id

    });

  } catch (error) {

    console.error(error);

  }



  if (roomChannel) {

    await supabase.removeChannel(roomChannel);

    roomChannel = null;

  }



  if (presenceChannel) {

    await supabase.removeChannel(presenceChannel);

    presenceChannel = null;

  }



  clearInterval(heartbeatTimer);



  currentRoom = null;

  currentSeat = null;

  isHost = false;



  if (playerPanel) {

    playerPanel.style.display = 'none';

  }



  if (welcomeElement) {

    welcomeElement.style.display = 'block';

  }

}



// ======================================================

// CADEIRAS

// ======================================================



function createSeatMarkers() {

  seatPositions = [];



  for (let i = 0; i < SEAT_CONFIG.total; i++) {

    const position = new THREE.Vector3(

      SEAT_CONFIG.startX + i * SEAT_CONFIG.columnSpacing,

      SEAT_CONFIG.startY,

      SEAT_CONFIG.startZ

    );



    seatPositions.push(position);



    const marker = createSeatMarker(i + 1, position);



    scene.add(marker);

    seatMarkers.push(marker);

  }

}



function createSeatMarker(number, position) {

  const canvas = document.createElement('canvas');

  canvas.width = 128;

  canvas.height = 128;



  const context = canvas.getContext('2d');



  context.fillStyle = '#ffffff';

  context.beginPath();

  context.arc(64, 64, 48, 0, Math.PI * 2);

  context.fill();



  context.fillStyle = '#111111';

  context.font = 'bold 48px Arial';

  context.textAlign = 'center';

  context.textBaseline = 'middle';

  context.fillText(String(number), 64, 64);



  const texture = new THREE.CanvasTexture(canvas);



  const material = new THREE.SpriteMaterial({

    map: texture,

    transparent: true

  });



  const sprite = new THREE.Sprite(material);



  sprite.position.copy(position);

  sprite.position.y += SEAT_CONFIG.markerHeight;

  sprite.scale.set(

    SEAT_CONFIG.markerSize,

    SEAT_CONFIG.markerSize,

    1

  );



  return sprite;

}



function setCameraToSeat(seatNumber) {

  const seat = seatPositions[seatNumber - 1];



  if (!seat) return;



  camera.position.copy(seat);



  camera.position.y += 0.1;



  camera.lookAt(LOOK_AT_START);

}



// ======================================================

// SELETOR DE CADEIRAS

// ======================================================



function createSeatSwitcher() {

  const select = $('#seatSelect');



  if (!select) return;



  select.innerHTML = '';



  for (let i = 1; i <= SEAT_CONFIG.total; i++) {

    const option = document.createElement('option');

    option.value = String(i);

    option.textContent = `Poltrona ${i}`;

    select.appendChild(option);

  }



  select.addEventListener('change', () => {

    const number = Number(select.value);



    currentSeat = number;

    setCameraToSeat(number);

  });

}



// ======================================================

// EVENTOS GERAIS

// ======================================================



function setupEvents() {

  window.addEventListener('resize', onResize);



  setupPlayerEvents();



  $('#createRoomBtn')?.addEventListener('click', createRoom);



  $('#joinRoomBtn')?.addEventListener('click', () => {

    const code = $('#roomCodeInput')?.value?.trim();



    if (code) {

      joinRoom(code);

    }

  });



  $('#leaveRoomBtn')?.addEventListener('click', leaveRoom);



  $('#videoUrlInput')?.addEventListener('keydown', event => {

    if (event.key === 'Enter') {

      loadVideoLink(event.target.value);

    }

  });



  $('#loadVideoBtn')?.addEventListener('click', () => {

    const value = $('#videoUrlInput')?.value;



    loadVideoLink(value);

  });



  $('#loginBtn')?.addEventListener('click', signIn);



  $('#logoutBtn')?.addEventListener('click', signOut);



  supabase.auth.getSession().then(({ data }) => {

    currentUser = data.session?.user || null;

  });



  supabase.auth.onAuthStateChange((_event, session) => {

    currentUser = session?.user || null;

  });

}



// ======================================================

// AUTENTICAÇÃO

// ======================================================



async function signIn() {

  const email = $('#emailInput')?.value?.trim();

  const password = $('#passwordInput')?.value;



  if (!email || !password) {

    showMessage('Preencha e-mail e senha.');

    return;

  }



  const { error } = await supabase.auth.signInWithPassword({

    email,

    password

  });



  if (error) {

    showMessage(error.message);

    return;

  }



  showMessage('Login realizado.');

}



async function signOut() {

  await leaveRoom();



  const { error } = await supabase.auth.signOut();



  if (error) {

    showMessage(error.message);

    return;

  }



  currentUser = null;

  showMessage('Você saiu da conta.');

}



// ======================================================

// UTILITÁRIOS

// ======================================================



function showMessage(message) {

  console.log(message);



  const element = $('#message');



  if (element) {

    element.textContent = message;

    element.style.display = 'block';



    clearTimeout(element._hideTimer);



    element._hideTimer = setTimeout(() => {

      element.style.display = 'none';

    }, 4000);

  }

}



function onResize() {

  if (!camera || !renderer || !cssRenderer) return;



  camera.aspect = window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();



  renderer.setSize(window.innerWidth, window.innerHeight);

  cssRenderer.setSize(window.innerWidth, window.innerHeight);

}



// ======================================================

// LIMPEZA

// ======================================================



window.addEventListener('beforeunload', () => {

  clearInterval(heartbeatTimer);



  stopVoice();



  if (localObjectUrl) {

    URL.revokeObjectURL(localObjectUrl);

  }

});



// ======================================================

// ANIMAÇÃO

// ======================================================



function animate() {

  requestAnimationFrame(animate);



  if (videoTexture) {

    videoTexture.needsUpdate = true;

  }



  renderer.render(scene, camera);

  cssRenderer.render(scene, camera);

}



// ======================================================

// VOZ

// ======================================================



async function startVoice() {

  try {

    localStream = await navigator.mediaDevices.getUserMedia({

      audio: true,

      video: false

    });



    if (!currentRoom) return;



    voiceChannel = supabase.channel(`voice-${currentRoom.id}`);



    voiceChannel.subscribe();

  } catch (error) {

    console.error('Erro ao iniciar voz:', error);

    showMessage('Não foi possível acessar o microfone.');

  }

}



function stopVoice() {

  if (localStream) {

    localStream.getTracks().forEach(track => track.stop());

    localStream = null;

  }



  for (const connection of peerConnections.values()) {

    connection.close();

  }



  peerConnections.clear();



  if (voiceChannel) {

    supabase.removeChannel(voiceChannel);

    voiceChannel = null;

  }

}



// ======================================================

// INICIAR

// ======================================================



init();
