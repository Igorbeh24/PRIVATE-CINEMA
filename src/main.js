import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { supabase } from './lib/supabase.js';
import './style.css';

// Ajuste as coordenadas abaixo depois de conferir as poltronas reais no Cine.glb.
const MODEL_PATH = '/models/Cine.glb';
const CAMERA_START = new THREE.Vector3(6.55, 2.65, 0);
const LOOK_AT_START = new THREE.Vector3(-4.42, 3.88, 0);
const SCREEN_NAME = 'Screen';
const SCREEN_CENTER = new THREE.Vector3(-4.415, 3.8777, 0);
const SCREEN_WIDTH = 12.65;
const SCREEN_HEIGHT = 7.0;
const MAX_SEATS = 12;
const SEAT_POSITIONS = Array.from({ length: MAX_SEATS }, (_, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return new THREE.Vector3(6.55 - row * 1.05, 2.65, (col - 1.5) * 1.35);
});
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const $ = (s) => document.querySelector(s);
const app = $('#app'), sceneHost = $('#scene'), cssHost = $('#css3d');
const loading = $('#loading'), welcome = $('#welcome'), hint = $('#hint');
const panel = $('#playerPanel'), message = $('#formMessage'), nowPlaying = $('#nowPlaying');
const toast = $('#toast');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090b);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 300);
camera.position.copy(CAMERA_START);
camera.rotation.order = 'YXZ';
camera.lookAt(LOOK_AT_START);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.id = 'cinemaCanvas';
renderer.domElement.setAttribute('aria-label', 'Sala de cinema 3D');
sceneHost.appendChild(renderer.domElement);
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(innerWidth, innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.inset = '0';
cssRenderer.domElement.style.pointerEvents = 'none';
cssHost.appendChild(cssRenderer.domElement);
scene.add(new THREE.HemisphereLight(0xb9c8df, 0x171014, 1.05));
const softLight = new THREE.DirectionalLight(0xffe3c2, 1.05);
softLight.position.set(1, 8, 4); scene.add(softLight);

let screenMesh = null, originalScreenMaterial = null;
let videoElement = null, videoTexture = null, embeddedObject = null, localObjectUrl = null;
let yaw = Math.PI / 2;
let pitch = Math.atan2(LOOK_AT_START.y - CAMERA_START.y, Math.hypot(LOOK_AT_START.x - CAMERA_START.x, LOOK_AT_START.z - CAMERA_START.z));
let entered = false;
let currentRoom = null, currentMember = null, roomChannel = null;
let roomMembers = [], isApplyingRemotePlayback = false, lastPlaybackWrite = 0, lastLoadedRemoteMedia = null, pendingSharedMediaUrl = null;
let localStream = null;
const peers = new Map();
const remoteAudio = new Map();
let heartbeatTimer = null;

function showToast(text) {
  toast.textContent = text; toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function updateCamera() { camera.rotation.y = yaw; camera.rotation.x = pitch; }
function setCameraToSeat(seatNumber) {
  const pos = SEAT_POSITIONS[seatNumber - 1] || CAMERA_START;
  camera.position.copy(pos);
  const dir = SCREEN_CENTER.clone().sub(pos).normalize();
  yaw = Math.atan2(-dir.x, -dir.z);
  pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  updateCamera();
}
function disposeCurrentVideo() {
  if (videoElement) { videoElement.pause(); videoElement.removeAttribute('src'); videoElement.load(); videoElement = null; }
  if (videoTexture) { videoTexture.dispose(); videoTexture = null; }
  if (embeddedObject) { scene.remove(embeddedObject); embeddedObject.element.remove(); embeddedObject = null; }
  if (screenMesh && originalScreenMaterial) screenMesh.material = originalScreenMaterial;
}
function makeEmbeddedScreen(url) {
  const frame = document.createElement('iframe');
  frame.width = '1920'; frame.height = '1080';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.title = 'Vídeo no telão do cinema'; frame.src = url;
  frame.style.cssText = 'width:1920px;height:1080px;border:0;background:#000';
  embeddedObject = new CSS3DObject(frame);
  embeddedObject.position.copy(SCREEN_CENTER); embeddedObject.position.x += 0.012;
  embeddedObject.rotation.y = Math.PI / 2;
  embeddedObject.scale.set(SCREEN_WIDTH / 1920, SCREEN_HEIGHT / 1080, 1);
  scene.add(embeddedObject);
  if (screenMesh) screenMesh.material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
}
function parseVideoLink(raw) {
  let url; try { url = new URL(raw); } catch { throw new Error('Cole um endereço válido.'); }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || '';
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2] || '';
    if (!/^[\w-]{6,}$/.test(id)) throw new Error('Não consegui identificar esse vídeo do YouTube.');
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=1&rel=0&modestbranding=1` };
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const match = url.pathname.match(/(\d+)/);
    if (!match) throw new Error('Não consegui identificar esse vídeo do Vimeo.');
    return { provider: 'vimeo', src: `https://player.vimeo.com/video/${match[1]}?autoplay=1&title=0&byline=0&portrait=0` };
  }
  if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.href)) return { provider: 'file', src: url.href };
  throw new Error('Use YouTube, Vimeo ou um link direto .mp4, .webm ou .ogg.');
}
function playDirectVideo(src, title = 'VÍDEO EXTERNO', remote = false) {
  disposeCurrentVideo();
  const video = document.createElement('video');
  video.src = src; video.crossOrigin = 'anonymous'; video.loop = false;
  video.muted = false; video.playsInline = true; video.preload = 'auto';
  video.addEventListener('error', () => showToast('Não foi possível carregar o vídeo. Verifique o link e o CORS do servidor.'), { once: true });
  videoElement = video;
  videoTexture = new THREE.VideoTexture(videoTextureSource(video));
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter; videoTexture.magFilter = THREE.LinearFilter; videoTexture.generateMipmaps = false;
  if (screenMesh) screenMesh.material = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide, toneMapped: false });
  video.addEventListener('play', () => { updatePlaybackUI(); if (!remote) publishPlayback('playing', pendingSharedMediaUrl || undefined); });
  video.addEventListener('pause', () => { updatePlaybackUI(); if (!remote && !video.ended) publishPlayback('paused', pendingSharedMediaUrl || undefined); });
  video.addEventListener('seeked', () => { updatePlaybackUI(); if (!remote) publishPlayback(video.paused ? 'paused' : 'playing', pendingSharedMediaUrl || undefined); });
  video.addEventListener('loadedmetadata', updatePlaybackUI);
  video.addEventListener('timeupdate', updatePlaybackUI);
  video.play().then(() => { if (!remote) showToast('Vídeo carregado no telão.'); }).catch(() => showToast('Clique no vídeo para iniciar a reprodução.'));
  nowPlaying.textContent = title.toUpperCase();
}
function videoTextureSource(video) { return video; }
async function loadVideoLink(raw, fromRemote = false) {
  try {
    const parsed = parseVideoLink(raw.trim());
    if (currentRoom && !isHost() && !fromRemote) throw new Error('Somente o anfitrião pode escolher o vídeo.');
    if (currentRoom && !fromRemote && parsed.provider !== 'file') {
      // YouTube/Vimeo são incorporados, mas sincronização precisa dos SDKs oficiais.
      // Para sincronização garantida nesta versão, use URL pública direta MP4/WebM.
      showToast('Para sincronizar play/pause entre todos, use um link público MP4 ou WebM.');
    }
    if (parsed.provider === 'file') {
      if (currentRoom && !fromRemote) throw new Error('Arquivo local só funciona no seu computador. Use um link público MP4/WebM na sala.');
      pendingSharedMediaUrl = currentRoom && !fromRemote ? parsed.src : null;
      playDirectVideo(parsed.src, raw, fromRemote);
      if (currentRoom && !fromRemote) await publishPlayback('playing', parsed.src);
      pendingSharedMediaUrl = null;
    } else {
      disposeCurrentVideo(); makeEmbeddedScreen(parsed.src);
      nowPlaying.textContent = parsed.provider === 'youtube' ? 'YOUTUBE NO TELÃO' : 'VIMEO NO TELÃO';
      if (currentRoom && !fromRemote) await publishPlayback('paused', raw);
      showToast('Player carregado no telão.');
    }
    panel.classList.remove('open'); message.textContent = 'Vídeo carregado.';
  } catch (error) { message.textContent = error.message; showToast(error.message); }
}
function loadLocalFile(file) {
  if (!file) return;
  if (currentRoom) { showToast('Arquivos locais não podem ser compartilhados. Use um link público MP4/WebM.'); return; }
  if (!file.type.startsWith('video/')) { showToast('Escolha um arquivo de vídeo.'); return; }
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  localObjectUrl = URL.createObjectURL(file); playDirectVideo(localObjectUrl, file.name);
  panel.classList.remove('open'); message.textContent = 'Arquivo local carregado nesta sessão.';
}

// ---------------- MULTIPLAYER / SUPABASE ----------------
function isHost() { return !!currentRoom && currentRoom.host_id === currentMember?.user_id; }
function setRoomStatus(text) { $('#roomStatus').textContent = text; }
function renderMembers() {
  const list = $('#memberList');
  if (!list) return;
  list.innerHTML = '';
  roomMembers.forEach(member => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.textContent = member.display_name + (member.user_id === currentRoom?.host_id ? ' · anfitrião' : '');
    const seat = document.createElement('small'); seat.textContent = `ASSENTO ${member.seat_number}`;
    li.append(name, seat); list.appendChild(li);
  });
  $('#roomCount').textContent = `${roomMembers.length}/${currentRoom?.max_seats || 0} PARTICIPANTES`;
  updatePlaybackUI();
  $('#hostControls').hidden = !isHost();
  $('#roomCodeDisplay').textContent = currentRoom?.code || '------';
}
async function ensureAuth() {
  let { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) {
    const result = await supabase.auth.signInAnonymously();
    if (result.error) throw result.error;
  }
  const { data } = await supabase.auth.getUser();
  return data.user;
}
async function createRoom() {
  try {
    await ensureAuth();
    const name = $('#displayName').value.trim() || 'Anfitrião';
    const { data, error } = await supabase.rpc('create_room', { p_name: $('#roomName').value.trim() || 'Cinema Privado', p_max_seats: Number($('#maxSeats').value) || 12 });
    if (error) throw error;
    await enterRoom(data.room, data.member);
    showToast(`Sala ${data.room.code} criada!`);
  } catch (e) { showToast(e.message || 'Não foi possível criar a sala.'); }
}
async function joinRoom() {
  try {
    await ensureAuth();
    const code = $('#joinCode').value.trim().toUpperCase();
    const name = $('#displayName').value.trim() || 'Visitante';
    const seat = $('#seatChoice').value ? Number($('#seatChoice').value) : null;
    if (!code) throw new Error('Digite o código da sala.');
    const { data, error } = await supabase.rpc('join_room', { p_code: code, p_display_name: name, p_seat_number: seat });
    if (error) throw error;
    await enterRoom(data.room, data.member);
    showToast(`Você entrou na sala ${data.room.code}.`);
  } catch (e) { showToast(e.message || 'Não foi possível entrar na sala.'); }
}
async function enterRoom(room, member) {
  currentRoom = room; currentMember = member;
  setCameraToSeat(member.seat_number);
  $('#roomGate').hidden = true; $('#roomHud').hidden = false;
  $('#roomRole').textContent = isHost() ? 'ANFITRIÃO' : 'CONVIDADO';
  $('#leaveRoomBtn').disabled = false;
  await refreshRoomState();
  await subscribeRoom();
  heartbeatTimer = setInterval(() => supabase.rpc('room_heartbeat'), 25000);
  $('#roomHud').classList.add('visible');
  if (currentRoom.media_url) applyRemoteRoomPlayback(currentRoom);
}
async function refreshRoomState() {
  const { data, error } = await supabase.rpc('get_room_state', { p_code: currentRoom.code });
  if (error) throw error;
  currentRoom = data.room; roomMembers = data.members || []; renderMembers();
}
async function subscribeRoom() {
  if (roomChannel) await supabase.removeChannel(roomChannel);
  roomChannel = supabase.channel(`cinema-${currentRoom.id}`, { config: { presence: { key: currentMember.user_id }, broadcast: { self: false } } });
  roomChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${currentRoom.id}` }, async () => { await refreshRoomState(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoom.id}` }, payload => {
      currentRoom = payload.new;
      if (!isHost()) applyRemoteRoomPlayback(currentRoom);
      renderMembers();
    })
    .on('broadcast', { event: 'rtc-signal' }, ({ payload }) => handleSignal(payload))
    .on('presence', { event: 'sync' }, () => connectPresentPeers())
    .on('presence', { event: 'leave' }, ({ key }) => closePeer(key));
  const status = await roomChannel.subscribe(async s => {
    if (s === 'SUBSCRIBED') {
      await roomChannel.track({ user_id: currentMember.user_id, name: currentMember.display_name, seat: currentMember.seat_number });
      setRoomStatus('CONECTADO');
    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setRoomStatus('RECONectando…');
  });
}
async function publishPlayback(status, mediaUrl = undefined) {
  if (!currentRoom || !isHost() || isApplyingRemotePlayback) return;
  const now = Date.now();
  if (now - lastPlaybackWrite < 800 && mediaUrl === undefined) return;
  lastPlaybackWrite = now;
  const position = videoElement?.currentTime || 0;
  const { error } = await supabase.rpc('set_room_playback', {
    p_status: status, p_position: position,
    p_media_url: mediaUrl === undefined ? (currentRoom.media_url || null) : mediaUrl
  });
  if (error) showToast(error.message);
}
async function applyRemoteRoomPlayback(room) {
  if (!room || isHost()) return;
  const media = room.media_url;
  if (media && media !== lastLoadedRemoteMedia) {
    // A URL pública direta é necessária para reprodução compartilhada.
    try {
      const parsed = parseVideoLink(media);
      if (parsed.provider === 'file') {
        isApplyingRemotePlayback = true;
        playDirectVideo(parsed.src, media, true);
        lastLoadedRemoteMedia = media;
        setTimeout(() => { isApplyingRemotePlayback = false; }, 1200);
      } else {
        showToast('Este tipo de player incorporado não oferece sincronização automática nesta versão.');
        lastLoadedRemoteMedia = media;
      }
    } catch { /* URL ainda não é um formato reproduzível */ }
  }
  if (!videoElement || !media || !/\.(mp4|webm|ogg)(?:$|[?#])/i.test(media)) return;
  const expected = Number(room.playback_position || 0) + (room.playback_status === 'playing' ? Math.max(0, (Date.now() - new Date(room.playback_updated_at).getTime()) / 1000) : 0);
  isApplyingRemotePlayback = true;
  try {
    if (Number.isFinite(expected) && Math.abs(videoElement.currentTime - expected) > 1.5) videoElement.currentTime = expected;
    if (room.playback_status === 'playing') await videoElement.play(); else videoElement.pause();
  } catch { /* O navegador pode exigir um clique inicial do convidado. */ }
  setTimeout(() => { isApplyingRemotePlayback = false; }, 500);
  updatePlaybackUI();
}
async function leaveRoom() {
  try {
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    stopVoice();
    if (roomChannel) { await supabase.removeChannel(roomChannel); roomChannel = null; }
    await supabase.rpc('leave_room');
  } catch (e) { console.warn('Saída da sala:', e); }
  currentRoom = null; currentMember = null; roomMembers = []; lastLoadedRemoteMedia = null;
  $('#roomHud').classList.remove('visible'); $('#roomHud').hidden = true; $('#roomGate').hidden = false;
  camera.position.copy(CAMERA_START); yaw = Math.PI / 2; pitch = Math.atan2(LOOK_AT_START.y - CAMERA_START.y, Math.hypot(LOOK_AT_START.x - CAMERA_START.x, LOOK_AT_START.z - CAMERA_START.z)); updateCamera();
  showToast('Você saiu da sala.');
}

// ---------------- VOZ: WebRTC + Supabase Realtime signaling ----------------
async function sendSignal(to, data) {
  if (!roomChannel) return;
  await roomChannel.send({ type: 'broadcast', event: 'rtc-signal', payload: { from: currentMember.user_id, to, ...data } });
}
function closePeer(id) {
  const pc = peers.get(id); if (pc) { pc.close(); peers.delete(id); }
  const audio = remoteAudio.get(id); if (audio) { audio.srcObject = null; audio.remove(); remoteAudio.delete(id); }
}
function createPeer(id) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  peers.set(id, pc);
  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = e => { if (e.candidate) sendSignal(id, { candidate: e.candidate }); };
  pc.ontrack = e => {
    let audio = remoteAudio.get(id);
    if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.playsInline = true; audio.dataset.peer = id; document.body.appendChild(audio); remoteAudio.set(id, audio); }
    audio.srcObject = e.streams[0]; audio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => { if (['failed','closed'].includes(pc.connectionState)) closePeer(id); };
  return pc;
}
async function connectPresentPeers() {
  if (!roomChannel || !currentMember) return;
  const state = roomChannel.presenceState();
  const ids = Object.keys(state).filter(id => id !== currentMember.user_id);
  for (const id of ids) {
    if (peers.has(id) || !localStream) continue;
    // Um único lado inicia a oferta para evitar ofertas duplicadas.
    if (currentMember.user_id < id) {
      const pc = createPeer(id);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await sendSignal(id, { description: pc.localDescription });
    }
  }
}
async function handleSignal(payload) {
  if (!payload || payload.to !== currentMember?.user_id || payload.from === currentMember?.user_id) return;
  try {
    if (payload.ready) {
      // O participante de ID menor inicia a oferta, evitando ofertas simultâneas.
      if (currentMember.user_id < payload.from) {
        const pc = createPeer(payload.from);
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        await sendSignal(payload.from, { description: pc.localDescription });
      }
      return;
    }
    const pc = createPeer(payload.from);
    if (payload.description) {
      await pc.setRemoteDescription(payload.description);
      if (payload.description.type === 'offer') {
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        await sendSignal(payload.from, { description: pc.localDescription });
      }
    } else if (payload.candidate) await pc.addIceCandidate(payload.candidate);
  } catch (e) { console.warn('Sinalização de voz:', e); }
}
async function startVoice() {
  if (!currentRoom) return showToast('Entre em uma sala primeiro.');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    $('#micBtn').textContent = 'MICROFONE LIGADO'; $('#micBtn').classList.add('active');
    // Recria peers para adicionar a nova faixa de áudio de forma consistente.
    const ids = [...peers.keys()]; ids.forEach(closePeer);
    const state = roomChannel.presenceState();
    for (const id of Object.keys(state).filter(id => id !== currentMember.user_id)) {
      await sendSignal(id, { ready: true });
      if (currentMember.user_id < id) {
        const pc = createPeer(id); const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        await sendSignal(id, { description: pc.localDescription });
      }
    }
    showToast('Microfone conectado.');
  } catch (e) { showToast(`Não foi possível acessar o microfone: ${e.message}`); }
}
function stopVoice() {
  peers.forEach((_, id) => closePeer(id));
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $('#micBtn')?.classList.remove('active'); if ($('#micBtn')) $('#micBtn').textContent = 'ATIVAR MICROFONE';
}

// ---------------- THREE.JS MODEL + INPUT ----------------
const loader = new GLTFLoader();
loader.load(MODEL_PATH, gltf => {
  const model = gltf.scene;
  model.traverse(obj => {
    if (obj.isMesh) {
      obj.frustumCulled = true;
      if (obj.name === SCREEN_NAME) { screenMesh = obj; originalScreenMaterial = Array.isArray(obj.material) ? obj.material.map(m => m.clone()) : obj.material.clone(); }
    }
  });
  model.traverse(obj => { if (obj.isMesh) console.log('OBJETO:', obj.name, 'POSIÇÃO:', obj.getWorldPosition(new THREE.Vector3())); });
  scene.add(model);
  if (!screenMesh) { console.warn(`Objeto "${SCREEN_NAME}" não encontrado.`); showToast('Modelo carregado; objeto Screen não encontrado.'); }
  loading.classList.add('done'); setTimeout(() => loading.remove(), 600);
  renderer.domElement.style.cursor = 'grab';
}, undefined, error => {
  console.error(error);
  loading.innerHTML = '<span>Não foi possível carregar Cine.glb.</span><span>Confira public/models/Cine.glb.</span>';
});
function enterCinema() {
  entered = true; welcome.classList.add('hidden'); hint.classList.add('visible');
  renderer.domElement.requestPointerLock?.(); setTimeout(() => hint.classList.remove('visible'), 5500);
}
renderer.domElement.addEventListener('click', () => { if (entered && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  renderer.domElement.style.cursor = locked ? 'none' : 'grab';
  if (entered && !locked) { hint.classList.add('visible'); setTimeout(() => hint.classList.remove('visible'), 3500); }
});
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= event.movementX * 0.0022; pitch -= event.movementY * 0.0022;
  yaw = THREE.MathUtils.clamp(yaw, -Math.PI * 2, Math.PI * 2);
  pitch = THREE.MathUtils.clamp(pitch, -1, 1); updateCamera();
});

// Existing controls
a$('#enterBtn')?.addEventListener('click', enterCinema);
a$('#movieBtn')?.addEventListener('click', () => panel.classList.toggle('open'));
a$('#closePanel')?.addEventListener('click', () => panel.classList.remove('open'));
a$('#videoForm')?.addEventListener('submit', event => { event.preventDefault(); const value = $('#videoUrl').value; if (value) loadVideoLink(value); else message.textContent = 'Cole primeiro o link do vídeo.'; });
a$('#videoFile')?.addEventListener('change', event => loadLocalFile(event.target.files?.[0]));
a$('#fullscreenBtn')?.addEventListener('click', async () => { try { if (!document.fullscreenElement) await app.requestFullscreen(); else await document.exitFullscreen(); } catch { showToast('O navegador não permitiu abrir a tela cheia.'); } });
a$('#playPauseBtn')?.addEventListener('click', async () => {
  if (!videoElement) return showToast('Carregue primeiro um vídeo direto MP4/WebM.');
  if (currentRoom && !isHost()) return showToast('Somente o anfitrião controla a reprodução.');
  try { if (videoElement.paused) await videoElement.play(); else videoElement.pause(); } catch { showToast('O navegador bloqueou a reprodução.'); }
});
a$('#seekBar')?.addEventListener('input', event => {
  if (!videoElement || (currentRoom && !isHost())) return;
  videoElement.currentTime = Number(event.target.value);
});

// Multiplayer controls
a$('#openRoomBtn')?.addEventListener('click', () => { $('#roomGate').hidden = false; $('#roomGate').classList.add('open'); });
a$('#closeRoomGate')?.addEventListener('click', () => { $('#roomGate').classList.remove('open'); $('#roomGate').hidden = true; });
a$('#createRoomBtn')?.addEventListener('click', createRoom);
a$('#joinRoomBtn')?.addEventListener('click', joinRoom);
a$('#leaveRoomBtn')?.addEventListener('click', leaveRoom);
a$('#copyCodeBtn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(currentRoom.code); showToast('Código copiado!'); } catch { showToast(`Código da sala: ${currentRoom.code}`); } });
a$('#micBtn')?.addEventListener('click', () => localStream ? stopVoice() : startVoice());
a$('#roomMovieBtn')?.addEventListener('click', () => { if (!isHost()) return showToast('Somente o anfitrião pode escolher o vídeo.'); panel.classList.toggle('open'); });

function updatePlaybackUI() {
  const button = $('#playPauseBtn'), seek = $('#seekBar');
  if (!button || !seek) return;
  const canControl = !!videoElement && (!currentRoom || isHost());
  button.disabled = !canControl; seek.disabled = !canControl;
  button.textContent = videoElement && !videoElement.paused ? 'Ⅱ PAUSAR' : '▶ REPRODUZIR';
  const duration = videoElement?.duration;
  seek.max = Number.isFinite(duration) && duration > 0 ? String(duration) : '100';
  if (videoElement && Number.isFinite(videoElement.currentTime)) seek.value = String(videoElement.currentTime);
}
function a$(selector) { return document.querySelector(selector); }
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); cssRenderer.setSize(innerWidth, innerHeight); }
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => { clearInterval(heartbeatTimer); stopVoice(); if (localObjectUrl) URL.revokeObjectURL(localObjectUrl); });
function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); cssRenderer.render(scene, camera); }
animate();
