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
  total: 13,
  columns: 13,
  startX: 6.6,
  startY: 2.65,
  startZ: -3.15,
  columnSpacing: 0.525,
  showNumbers: true,
  markerHeight: 0.8,
  markerSize: 0.38
};

const MAX_SEATS = SEAT_CONFIG.total;

const SEAT_POSITIONS = Array.from({ length: MAX_SEATS }, (_, i) => {
  return new THREE.Vector3(
    SEAT_CONFIG.startX,
    SEAT_CONFIG.startY,
    SEAT_CONFIG.startZ + i * SEAT_CONFIG.columnSpacing
  );
});

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
];

const $ = (s) => document.querySelector(s);

const app = $('#app');
const sceneHost = $('#scene');
const cssHost = $('#css3d');

const loading = $('#loading');
const welcome = $('#welcome');
const hint = $('#hint');

const panel = $('#playerPanel');
const message = $('#formMessage');
const nowPlaying = $('#nowPlaying');

const toast = $('#toast');

// ======================================================
// CENA THREE.JS
// ======================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090b);

const camera = new THREE.PerspectiveCamera(
  62,
  innerWidth / innerHeight,
  0.05,
  300
);

camera.position.copy(CAMERA_START);
camera.rotation.order = 'YXZ';
camera.lookAt(LOOK_AT_START);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});

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
softLight.position.set(1, 8, 4);
scene.add(softLight);

// ======================================================
// MARCAÇÕES VISUAIS DAS CADEIRAS
// ======================================================

const seatMarkers = new THREE.Group();
seatMarkers.name = 'SeatMarkers';
scene.add(seatMarkers);

function createSeatLabel(number, position) {
  const canvas = document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 160;

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(8, 9, 11, 0.92)';

  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 144, 24);
  ctx.fill();

  ctx.strokeStyle = '#b8d8d8';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 75px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(
    String(number).padStart(2, '0'),
    256,
    80
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);

  sprite.position.copy(position);
  sprite.position.y += SEAT_CONFIG.markerHeight;

  sprite.scale.set(
    SEAT_CONFIG.markerSize * 2.5,
    SEAT_CONFIG.markerSize * 0.8,
    1
  );

  sprite.renderOrder = 999;

  seatMarkers.add(sprite);

  console.log(
    `CADEIRA ${String(number).padStart(2, '0')}`,
    `X: ${position.x.toFixed(3)}`,
    `Y: ${position.y.toFixed(3)}`,
    `Z: ${position.z.toFixed(3)}`
  );
}

function updateSeatMarkers() {
  seatMarkers.clear();

  if (!SEAT_CONFIG.showNumbers) return;

  SEAT_POSITIONS.forEach((position, index) => {
    createSeatLabel(index + 1, position);
  });

  console.log('================================');
  console.log('POSIÇÕES DE TODAS AS CADEIRAS');
  console.log('================================');
}

// ======================================================
// ESTADO DO SISTEMA
// ======================================================

let screenMesh = null;
let originalScreenMaterial = null;
let originalScreenVisible = true;

let videoElement = null;
let videoTexture = null;
let embeddedObject = null;

let youtubePlayer = null;
let youtubeReady = false;
let youtubeCurrentId = null;
let youtubeSyncTimer = null;

let localObjectUrl = null;

let yaw = Math.PI / 2;

let pitch = Math.atan2(
  LOOK_AT_START.y - CAMERA_START.y,
  Math.hypot(
    LOOK_AT_START.x - CAMERA_START.x,
    LOOK_AT_START.z - CAMERA_START.z
  )
);

let entered = false;

let currentRoom = null;
let currentMember = null;
let roomChannel = null;

let roomMembers = [];
let isApplyingRemotePlayback = false;
let lastPlaybackWrite = 0;
let lastLoadedRemoteMedia = null;
let pendingSharedMediaUrl = null;
let isSeeking = false;

let localStream = null;

const peers = new Map();
const remoteAudio = new Map();

let heartbeatTimer = null;

// ======================================================
// NOTIFICAÇÕES
// ======================================================

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// ======================================================
// CÂMERA
// ======================================================

function updateCamera() {
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function setCameraToSeat(seatNumber) {
  const pos = SEAT_POSITIONS[seatNumber - 1] || CAMERA_START;

  camera.position.copy(pos);

  const dir = SCREEN_CENTER.clone().sub(pos).normalize();

  yaw = Math.atan2(-dir.x, -dir.z);

  pitch = Math.atan2(
    dir.y,
    Math.hypot(dir.x, dir.z)
  );

  updateCamera();
}

// ======================================================
// VÍDEO
// ======================================================

function disposeCurrentVideo() {
    if (videoElement) {
        videoElement.pause();
        videoElement.removeAttribute('src');
        videoElement.load();
        videoElement = null;
    }

    if (videoTexture) {
        videoTexture.dispose();
        videoTexture = null;
    }

    if (youtubeSyncTimer) {
        clearInterval(youtubeSyncTimer);
        youtubeSyncTimer = null;
    }

    if (youtubePlayer) {
        try {
            youtubePlayer.destroy();
        } catch (error) {
            console.warn(error);
        }

        youtubePlayer = null;
    }

    youtubeReady = false;
    youtubeCurrentId = null;

    if (embeddedObject) {
        scene.remove(embeddedObject);
        embeddedObject.element.remove();
        embeddedObject = null;
    }

    if (screenMesh && originalScreenMaterial) {
        screenMesh.material = originalScreenMaterial;
        screenMesh.visible = originalScreenVisible;
    }

    renderer.domElement.style.visibility = 'visible';
}
}

// ======================================================
// API OFICIAL DO YOUTUBE
// ======================================================

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }

  if (window.__privateCinemaYTApiPromise) {
    return window.__privateCinemaYTApiPromise;
  }

  window.__privateCinemaYTApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      try {
        previousCallback?.();
      } catch (error) {
        console.warn(error);
      }

      resolve(window.YT);
    };

    let script = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;

      script.onerror = () => {
        reject(new Error('Não foi possível carregar a API do YouTube.'));
      };

      document.head.appendChild(script);
    }
  });

  return window.__privateCinemaYTApiPromise;
}

async function makeYouTubeScreen(videoId) {
    disposeCurrentVideo();

    renderer.domElement.style.visibility = 'hidden';

    const container = document.createElement('div');

    container.id = 'privateCinemaYouTubePlayer';

    container.style.cssText =
        'width:1920px;height:1080px;background:#000;overflow:hidden';

    embeddedObject = new CSS3DObject(container);

    embeddedObject.position.copy(SCREEN_CENTER);
    embeddedObject.position.x += 0.012;
    embeddedObject.rotation.y = Math.PI / 2;

    embeddedObject.scale.set(
        SCREEN_WIDTH / 1920,
        SCREEN_HEIGHT / 1080,
        1
    );

    scene.add(embeddedObject);

    if (screenMesh) {
        screenMesh.visible = false;
    }

    youtubeCurrentId = videoId;
    nowPlaying.textContent = 'YOUTUBE NO TELÃO';

    try {
        const YT = await loadYouTubeAPI();

        if (youtubeCurrentId !== videoId || !container.isConnected) {
            renderer.domElement.style.visibility = 'visible';
            return;
        }

        youtubePlayer = new YT.Player(container, {
            width: '1920',
            height: '1080',
            videoId,

            playerVars: {
                autoplay: 1,
                controls: 1,
                rel: 0,
                playsinline: 1,
                enablejsapi: 1,
                origin: window.location.origin
            },

            events: {
                onReady: event => {
                    if (youtubeCurrentId !== videoId) return;

                    youtubeReady = true;
                    updatePlaybackUI();

                    event.target.playVideo();
                },

                onStateChange: () => {
                    updatePlaybackUI();
                },

                onError: event => {
                    console.error('YouTube Player error:', event.data);
                    showToast(`Erro do YouTube (${event.data}).`);
                }
            }
        });

    } catch (error) {
        renderer.domElement.style.visibility = 'visible';
        showToast(error.message || 'Erro ao iniciar o YouTube.');
    }
}

  youtubeCurrentId = videoId;
  nowPlaying.textContent = 'YOUTUBE NO TELÃO';

  try {
    const YT = await loadYouTubeAPI();

    if (youtubeCurrentId !== videoId || !container.isConnected) {
      return;
    }

    youtubePlayer = new YT.Player(container, {
      width: '1920',
      height: '1080',
      videoId,

      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin
      },

      events: {
        onReady: event => {
          if (youtubeCurrentId !== videoId) return;

          youtubeReady = true;

          updatePlaybackUI();

          if (currentRoom && !isHost()) {
            applyRemoteRoomPlayback(currentRoom);
          } else {
            try {
              event.target.playVideo();
            } catch (error) {
              console.warn(error);
            }
          }

          if (currentRoom && isHost()) {
            if (youtubeSyncTimer) {
              clearInterval(youtubeSyncTimer);
            }

            youtubeSyncTimer = setInterval(() => {
              if (!youtubeReady || !youtubePlayer || !isHost()) {
                return;
              }

              const state = youtubePlayer.getPlayerState();

              if (
                state === YT.PlayerState.PLAYING ||
                state === YT.PlayerState.PAUSED
              ) {
                publishPlayback(
                  state === YT.PlayerState.PLAYING
                    ? 'playing'
                    : 'paused',
                  undefined,
                  true
                );
              }
            }, 3000);
          }
        },

        onStateChange: event => {
          updatePlaybackUI();

          if (
            !currentRoom ||
            !isHost() ||
            isApplyingRemotePlayback
          ) {
            return;
          }

          if (event.data === YT.PlayerState.PLAYING) {
            publishPlayback('playing', undefined, true);
          }

          if (
            event.data === YT.PlayerState.PAUSED ||
            event.data === YT.PlayerState.ENDED
          ) {
            publishPlayback('paused', undefined, true);
          }
        },

        onError: event => {
          console.error('YouTube Player error:', event.data);

          const messages = {
            2: 'O endereço do vídeo do YouTube é inválido.',
            5: 'O YouTube não conseguiu reproduzir este vídeo.',
            100: 'Vídeo não encontrado ou privado.',
            101: 'O proprietário não permite reprodução incorporada.',
            150: 'O proprietário não permite reprodução incorporada.',
            153: 'O YouTube não recebeu a identificação de origem necessária.'
          };

          showToast(
            messages[event.data] ||
            `Erro do YouTube (${event.data}).`
          );
        }
      }
    });

  } catch (error) {
    showToast(
      error.message ||
      'Não foi possível iniciar o player do YouTube.'
    );
  }
}

// ======================================================
// PLAYER EMBUTIDO - VIMEO
// ======================================================

function makeEmbeddedScreen(url) {
  const frame = document.createElement('iframe');

  frame.width = '1920';
  frame.height = '1080';

  frame.allow =
    'autoplay; encrypted-media; picture-in-picture; fullscreen';

  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.title = 'Vídeo no telão do cinema';
  frame.src = url;

  frame.style.cssText =
    'width:1920px;height:1080px;border:0;background:#000';

  embeddedObject = new CSS3DObject(frame);

  embeddedObject.position.copy(SCREEN_CENTER);
  embeddedObject.position.x += 0.012;
  embeddedObject.rotation.y = -Math.PI / 2;

  embeddedObject.scale.set(
    SCREEN_WIDTH / 1920,
    SCREEN_HEIGHT / 1080,
    1
  );

  scene.add(embeddedObject);

  if (screenMesh) {
    screenMesh.visible = false;
}
}
// ======================================================
// IDENTIFICAÇÃO DOS LINKS
// ======================================================

function parseVideoLink(raw) {
  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('Cole um endereço válido.');
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (
    host === 'youtu.be' ||
    host.endsWith('youtube.com') ||
    host.endsWith('youtube-nocookie.com')
  ) {
    let id = '';

    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') || '';
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.split('/')[2] || '';
    } else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.split('/')[2] || '';
    }

    if (!/^[\w-]{6,}$/.test(id)) {
      throw new Error('Não consegui identificar esse vídeo do YouTube.');
    }

    return {
      provider: 'youtube',
      id,
      src: `https://www.youtube.com/embed/${id}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&autoplay=1&controls=1&rel=0`
    };
  }

  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const match = url.pathname.match(/(\d+)/);

    if (!match) {
      throw new Error('Não consegui identificar esse vídeo do Vimeo.');
    }

    return {
      provider: 'vimeo',
      src: `https://player.vimeo.com/video/${match[1]}?autoplay=1&title=0&byline=0&portrait=0`
    };
  }

  if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.href)) {
    return {
      provider: 'file',
      src: url.href
    };
  }

  throw new Error('Use YouTube, Vimeo ou um link direto .mp4, .webm ou .ogg.');
}

// ======================================================
// REPRODUÇÃO DE VÍDEOS DIRETOS
// ======================================================

function playDirectVideo(src, title = 'VÍDEO EXTERNO', remote = false) {
  disposeCurrentVideo();

  const video = document.createElement('video');

  video.src = src;
  video.crossOrigin = 'anonymous';
  video.loop = false;
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';

  video.addEventListener('error', () => {
    showToast('Não foi possível carregar o vídeo. Verifique se o link é público e permite reprodução externa.');
  }, { once: true });

  videoElement = video;

  videoTexture = new THREE.VideoTexture(videoTextureSource(video));
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  if (screenMesh) {
    screenMesh.material = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.DoubleSide,
      toneMapped: false
    });
  }

  video.addEventListener('play', updatePlaybackUI);
  video.addEventListener('pause', updatePlaybackUI);
  video.addEventListener('seeked', updatePlaybackUI);
  video.addEventListener('loadedmetadata', updatePlaybackUI);
  video.addEventListener('timeupdate', updatePlaybackUI);

  video.play()
    .then(() => {
      if (!remote) showToast('Vídeo carregado no telão.');
    })
    .catch(() => {
      showToast('Clique em reproduzir para iniciar o vídeo.');
    });

  nowPlaying.textContent = title.toUpperCase();
}

function videoTextureSource(video) {
  return video;
}

// ======================================================
// CARREGAR LINK
// ======================================================

async function loadVideoLink(raw, fromRemote = false) {
  try {
    const parsed = parseVideoLink(raw.trim());

    if (currentRoom && !isHost() && !fromRemote) {
      throw new Error('Somente o anfitrião pode escolher o vídeo.');
    }

    if (parsed.provider === 'file') {
      pendingSharedMediaUrl =
        currentRoom && !fromRemote ? parsed.src : null;

      playDirectVideo(parsed.src, raw, fromRemote);

      if (currentRoom && !fromRemote) {
        await publishPlayback('playing', parsed.src, true);
      }

      pendingSharedMediaUrl = null;

    } else {
      disposeCurrentVideo();

      if (parsed.provider === 'youtube') {
        await makeYouTubeScreen(parsed.id);
      } else {
        makeEmbeddedScreen(parsed.src);
        nowPlaying.textContent = 'VIMEO NO TELÃO';
      }

      if (currentRoom && !fromRemote) {
        await publishPlayback('playing', raw, true);
        showToast('Link enviado para a sala.');
      } else {
        showToast('Player carregado no telão.');
      }
    }

    panel.classList.remove('open');
    message.textContent = 'Vídeo carregado.';

  } catch (error) {
    pendingSharedMediaUrl = null;
    message.textContent = error.message;
    showToast(error.message);
  }
}

// ======================================================
// ARQUIVOS LOCAIS
// ======================================================

function loadLocalFile(file) {
  if (!file) return;

  if (currentRoom) {
    showToast('Arquivos locais não podem ser compartilhados. Use um link público MP4/WebM.');
    return;
  }

  if (!file.type.startsWith('video/')) {
    showToast('Escolha um arquivo de vídeo.');
    return;
  }

  if (localObjectUrl) {
    URL.revokeObjectURL(localObjectUrl);
  }

  localObjectUrl = URL.createObjectURL(file);

  playDirectVideo(localObjectUrl, file.name);

  panel.classList.remove('open');
  message.textContent = 'Arquivo local carregado nesta sessão.';
}

// ======================================================
// MULTIPLAYER / SUPABASE
// ======================================================

function isHost() {
  return !!currentRoom &&
    currentRoom.host_id === currentMember?.user_id;
}

function setRoomStatus(text) {
  $('#roomStatus').textContent = text;
}

function renderMembers() {
  const list = $('#memberList');

  if (!list) return;

  list.innerHTML = '';

  roomMembers.forEach(member => {
    const li = document.createElement('li');

    const name = document.createElement('span');

    name.textContent = member.display_name +
      (member.user_id === currentRoom?.host_id
        ? ' · anfitrião'
        : '');

    const seat = document.createElement('small');

    seat.textContent = `ASSENTO ${member.seat_number}`;

    li.append(name, seat);
    list.appendChild(li);
  });

  $('#roomCount').textContent =
    `${roomMembers.length}/${currentRoom?.max_seats || 0} PARTICIPANTES`;

  updatePlaybackUI();

  $('#hostControls').hidden = !isHost();

  $('#roomCodeDisplay').textContent =
    currentRoom?.code || '------';
}

// ======================================================
// AUTENTICAÇÃO
// ======================================================

async function ensureAuth() {
  let { data: { session }, error } =
    await supabase.auth.getSession();

  if (error) throw error;

  if (!session) {
    const result = await supabase.auth.signInAnonymously();

    if (result.error) throw result.error;
  }

  const { data } = await supabase.auth.getUser();

  return data.user;
}

// ======================================================
// CRIAR SALA
// ======================================================

async function createRoom() {
  try {
    await ensureAuth();

    const name =
      $('#displayName').value.trim() || 'Anfitrião';

    const { data, error } = await supabase.rpc('create_room', {
      p_name: $('#roomName').value.trim() || 'Cinema Privado',
      p_max_seats: Number($('#maxSeats').value) || 12
    });

    if (error) throw error;

    await enterRoom(data.room, data.member);

    showToast(`Sala ${data.room.code} criada!`);

  } catch (e) {
    showToast(e.message || 'Não foi possível criar a sala.');
  }
}

// ======================================================
// ENTRAR EM UMA SALA
// ======================================================

async function joinRoom() {
  try {
    await ensureAuth();

    const code =
      $('#joinCode').value.trim().toUpperCase();

    const name =
      $('#displayName').value.trim() || 'Visitante';

    const seat = $('#seatChoice').value
      ? Number($('#seatChoice').value)
      : null;

    if (!code) {
      throw new Error('Digite o código da sala.');
    }

    const { data, error } = await supabase.rpc('join_room', {
      p_code: code,
      p_display_name: name,
      p_seat_number: seat
    });

    if (error) throw error;

    await enterRoom(data.room, data.member);

    showToast(`Você entrou na sala ${data.room.code}.`);

  } catch (e) {
    showToast(e.message || 'Não foi possível entrar na sala.');
  }
}

// ======================================================
// ENTRADA NA SALA
// ======================================================

async function enterRoom(room, member) {
  currentRoom = room;
  currentMember = member;

  setCameraToSeat(member.seat_number);

  $('#roomGate').hidden = true;
  $('#roomHud').hidden = false;

  $('#roomRole').textContent =
    isHost() ? 'ANFITRIÃO' : 'CONVIDADO';

  $('#leaveRoomBtn').disabled = false;

  await refreshRoomState();

  await subscribeRoom();

  heartbeatTimer = setInterval(() => {
    supabase.rpc('room_heartbeat');
  }, 25000);

  $('#roomHud').classList.add('visible');

  if (currentRoom.media_url) {
    await applyRemoteRoomPlayback(currentRoom);
  }
}

// ======================================================
// ATUALIZAR ESTADO DA SALA
// ======================================================

async function refreshRoomState() {
  const { data, error } = await supabase.rpc('get_room_state', {
    p_code: currentRoom.code
  });

  if (error) throw error;

  currentRoom = data.room;
  roomMembers = data.members || [];

  renderMembers();
}

// ======================================================
// SUPABASE REALTIME
// ======================================================

async function subscribeRoom() {
  if (roomChannel) {
    await supabase.removeChannel(roomChannel);
  }

  roomChannel = supabase.channel(
    `cinema-${currentRoom.id}`,
    {
      config: {
        presence: {
          key: currentMember.user_id
        },
        broadcast: {
          self: false
        }
      }
    }
  );

  roomChannel

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${currentRoom.id}`
      },
      async () => {
        await refreshRoomState();
      }
    )

    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${currentRoom.id}`
      },
      payload => {
        currentRoom = payload.new;

        if (!isHost()) {
          applyRemoteRoomPlayback(currentRoom);
        }

        renderMembers();
      }
    )

    .on(
      'broadcast',
      { event: 'rtc-signal' },
      ({ payload }) => {
        handleSignal(payload);
      }
    )

    .on('presence', { event: 'sync' }, () => {
      connectPresentPeers();
    })

    .on('presence', { event: 'leave' }, ({ key }) => {
      closePeer(key);
    });

  await roomChannel.subscribe(async status => {

    if (status === 'SUBSCRIBED') {

      await roomChannel.track({
        user_id: currentMember.user_id,
        name: currentMember.display_name,
        seat: currentMember.seat_number
      });

      setRoomStatus('CONECTADO');

    } else if (
      status === 'CHANNEL_ERROR' ||
      status === 'TIMED_OUT'
    ) {
      setRoomStatus('RECONectando…');
    }

  });
}
// ======================================================
// SINCRONIZAÇÃO DA REPRODUÇÃO
// ======================================================

async function publishPlayback(status, mediaUrl = undefined, force = false) {
  if (!currentRoom || !isHost() || isApplyingRemotePlayback) return;

  const now = Date.now();

  if (!force && now - lastPlaybackWrite < 250) return;

  lastPlaybackWrite = now;

  let position = Number(currentRoom.playback_position || 0);

  if (videoElement && Number.isFinite(videoElement.currentTime)) {
    position = videoElement.currentTime;
  } else if (youtubeReady && youtubePlayer) {
    position = Number(youtubePlayer.getCurrentTime() || 0);
  }

  const { data, error } = await supabase.rpc('set_room_playback', {
    p_room_id: currentRoom.id,
    p_status: status,
    p_position: position,
    p_media_url: mediaUrl === undefined
      ? (currentRoom.media_url || null)
      : mediaUrl
  });

  if (error) {
    console.error('Erro ao compartilhar reprodução:', error);
    showToast(`Não foi possível sincronizar: ${error.message}`);
    return;
  }

  if (data && typeof data === 'object') {
    currentRoom = { ...currentRoom, ...data };
  } else {
    currentRoom = {
      ...currentRoom,
      media_url: mediaUrl === undefined
        ? currentRoom.media_url
        : mediaUrl,
      playback_status: status,
      playback_position: position,
      playback_updated_at: new Date().toISOString()
    };
  }
}

// ======================================================
// AGUARDAR METADADOS DO VÍDEO
// ======================================================

async function waitForVideoMetadata(video) {
  if (video.readyState >= 1) return;

  await new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new Error(
          'O vídeo não carregou. Confira se o link é público e permite reprodução externa.'
        )
      );
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

// ======================================================
// APLICAR REPRODUÇÃO RECEBIDA DO ANFITRIÃO
// ======================================================

async function applyRemoteRoomPlayback(room) {
  if (!room || isHost() || !room.media_url) return;

  const media = room.media_url;

  try {
    if (media !== lastLoadedRemoteMedia) {
      const parsed = parseVideoLink(media);

      disposeCurrentVideo();

      if (parsed.provider === 'file') {
        playDirectVideo(parsed.src, media, true);

        lastLoadedRemoteMedia = media;

        const video = videoElement;

        await waitForVideoMetadata(video);

      } else if (parsed.provider === 'youtube') {
        lastLoadedRemoteMedia = media;

        await makeYouTubeScreen(parsed.id);

        // A API pode demorar para inicializar.
        // O estado será aplicado novamente no evento onReady.
        return;

      } else {
        makeEmbeddedScreen(parsed.src);

        nowPlaying.textContent = 'VIMEO NO TELÃO';

        lastLoadedRemoteMedia = media;

        showToast(
          'O anfitrião compartilhou um vídeo. Player carregado.'
        );

        return;
      }
    }

    // ==================================================
    // SINCRONIZAÇÃO DO YOUTUBE
    // ==================================================

    if (!videoElement && youtubeReady && youtubePlayer) {
      const updatedAt = room.playback_updated_at
        ? new Date(room.playback_updated_at).getTime()
        : Date.now();

      const elapsed = room.playback_status === 'playing'
        ? Math.max(0, (Date.now() - updatedAt) / 1000)
        : 0;

      const expected =
        Number(room.playback_position || 0) + elapsed;

      isApplyingRemotePlayback = true;

      try {
        const currentTime = Number(
          youtubePlayer.getCurrentTime() || 0
        );

        if (
          Number.isFinite(expected) &&
          Math.abs(currentTime - expected) > 1.25
        ) {
          youtubePlayer.seekTo(expected, true);
        }

        if (room.playback_status === 'playing') {
          youtubePlayer.playVideo();
        } else {
          youtubePlayer.pauseVideo();
        }

      } finally {
        setTimeout(() => {
          isApplyingRemotePlayback = false;
        }, 500);
      }

      updatePlaybackUI();
      return;
    }

    // ==================================================
    // SINCRONIZAÇÃO DE MP4 / WEBM / OGG
    // ==================================================

    if (!videoElement) return;

    const video = videoElement;

    const updatedAt = room.playback_updated_at
      ? new Date(room.playback_updated_at).getTime()
      : Date.now();

    const elapsed = room.playback_status === 'playing'
      ? Math.max(0, (Date.now() - updatedAt) / 1000)
      : 0;

    const basePosition = Number(
      room.playback_position || 0
    );

    const expected = basePosition + elapsed;

    isApplyingRemotePlayback = true;

    if (
      Number.isFinite(expected) &&
      video.readyState >= 1
    ) {
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : expected;

      const target = Math.min(expected, duration);

      if (Math.abs(video.currentTime - target) > 0.8) {
        video.currentTime = target;
      }
    }

    if (room.playback_status === 'playing') {
      try {
        await video.play();
      } catch {
        showToast(
          'Clique em reproduzir para liberar o áudio neste navegador.'
        );
      }
    } else {
      video.pause();
    }

    updatePlaybackUI();

  } catch (error) {
    console.error('Erro ao sincronizar vídeo:', error);

    showToast(
      error.message || 'Não foi possível sincronizar o vídeo.'
    );

  } finally {
    setTimeout(() => {
      isApplyingRemotePlayback = false;
    }, 500);
  }
}

// ======================================================
// SAIR DA SALA
// ======================================================

async function leaveRoom() {
  try {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;

    stopVoice();

    if (roomChannel) {
      await supabase.removeChannel(roomChannel);
      roomChannel = null;
    }

    await supabase.rpc('leave_room');

  } catch (e) {
    console.warn('Saída da sala:', e);
  }

  currentRoom = null;
  currentMember = null;
  roomMembers = [];
  lastLoadedRemoteMedia = null;

  $('#roomHud').classList.remove('visible');
  $('#roomHud').hidden = true;

  $('#roomGate').hidden = false;

  camera.position.copy(CAMERA_START);

  yaw = Math.PI / 2;

  pitch = Math.atan2(
    LOOK_AT_START.y - CAMERA_START.y,
    Math.hypot(
      LOOK_AT_START.x - CAMERA_START.x,
      LOOK_AT_START.z - CAMERA_START.z
    )
  );

  updateCamera();

  showToast('Você saiu da sala.');
}

// ======================================================
// VOZ: WEBRTC + SUPABASE REALTIME
// ======================================================

async function sendSignal(to, data) {
  if (!roomChannel) return;

  await roomChannel.send({
    type: 'broadcast',
    event: 'rtc-signal',
    payload: {
      from: currentMember.user_id,
      to,
      ...data
    }
  });
}

// ======================================================
// FECHAR CONEXÃO DE UM PARTICIPANTE
// ======================================================

function closePeer(id) {
  const pc = peers.get(id);

  if (pc) {
    pc.close();
    peers.delete(id);
  }

  const audio = remoteAudio.get(id);

  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudio.delete(id);
  }
}

// ======================================================
// CRIAR CONEXÃO WEBRTC
// ======================================================

function createPeer(id) {
  if (peers.has(id)) return peers.get(id);

  const pc = new RTCPeerConnection({
    iceServers: STUN_SERVERS
  });

  peers.set(id, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignal(id, {
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let audio = remoteAudio.get(id);

    if (!audio) {
      audio = document.createElement('audio');

      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.peer = id;

      document.body.appendChild(audio);

      remoteAudio.set(id, audio);
    }

    audio.srcObject = event.streams[0];

    audio.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (
      ['failed', 'closed'].includes(pc.connectionState)
    ) {
      closePeer(id);
    }
  };

  return pc;
}

// ======================================================
// CONECTAR PARTICIPANTES PRESENTES
// ======================================================

async function connectPresentPeers() {
  if (!roomChannel || !currentMember) return;

  const state = roomChannel.presenceState();

  const ids = Object.keys(state).filter(
    id => id !== currentMember.user_id
  );

  for (const id of ids) {
    if (peers.has(id) || !localStream) continue;

    if (currentMember.user_id < id) {
      const pc = createPeer(id);

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      await sendSignal(id, {
        description: pc.localDescription
      });
    }
  }
}

// ======================================================
// RECEBER SINALIZAÇÃO WEBRTC
// ======================================================

async function handleSignal(payload) {
  if (
    !payload ||
    payload.to !== currentMember?.user_id ||
    payload.from === currentMember?.user_id
  ) {
    return;
  }

  try {
    if (payload.ready) {
      if (currentMember.user_id < payload.from) {
        const pc = createPeer(payload.from);

        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);

        await sendSignal(payload.from, {
          description: pc.localDescription
        });
      }

      return;
    }

    const pc = createPeer(payload.from);

    if (payload.description) {
      await pc.setRemoteDescription(payload.description);

      if (payload.description.type === 'offer') {
        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);

        await sendSignal(payload.from, {
          description: pc.localDescription
        });
      }

    } else if (payload.candidate) {
      await pc.addIceCandidate(payload.candidate);
    }

  } catch (e) {
    console.warn('Sinalização de voz:', e);
  }
}

// ======================================================
// ATIVAR MICROFONE
// ======================================================

async function startVoice() {
  if (!currentRoom) {
    return showToast('Entre em uma sala primeiro.');
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    $('#micBtn').textContent = 'MICROFONE LIGADO';
    $('#micBtn').classList.add('active');

    const ids = [...peers.keys()];

    ids.forEach(closePeer);

    const state = roomChannel.presenceState();

    for (
      const id of Object.keys(state).filter(
        id => id !== currentMember.user_id
      )
    ) {
      await sendSignal(id, { ready: true });

      if (currentMember.user_id < id) {
        const pc = createPeer(id);

        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);

        await sendSignal(id, {
          description: pc.localDescription
        });
      }
    }

    showToast('Microfone conectado.');

  } catch (e) {
    showToast(
      `Não foi possível acessar o microfone: ${e.message}`
    );
  }
}

// ======================================================
// DESATIVAR MICROFONE
// ======================================================

function stopVoice() {
  peers.forEach((_, id) => closePeer(id));

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  $('#micBtn')?.classList.remove('active');

  if ($('#micBtn')) {
    $('#micBtn').textContent = 'ATIVAR MICROFONE';
  }
}
// ======================================================
// CARREGAMENTO DO MODELO 3D
// ======================================================

const loader = new GLTFLoader();

loader.load(
  MODEL_PATH,

  gltf => {
    const model = gltf.scene;

    model.traverse(obj => {
      if (obj.isMesh) {
        obj.frustumCulled = true;

        if (obj.name === SCREEN_NAME) {
          screenMesh = obj;
originalScreenVisible = obj.visible;

          originalScreenMaterial = Array.isArray(obj.material)
            ? obj.material.map(m => m.clone())
            : obj.material.clone();
        }
      }
    });

    model.traverse(obj => {
      if (obj.isMesh) {
        console.log(
          'OBJETO:',
          obj.name,
          'POSIÇÃO:',
          obj.getWorldPosition(new THREE.Vector3())
        );
      }
    });

    scene.add(model);

    updateSeatMarkers();

    if (!screenMesh) {
      console.warn(`Objeto "${SCREEN_NAME}" não encontrado.`);
      showToast('Modelo carregado; objeto Screen não encontrado.');
    }

    loading.classList.add('done');

    setTimeout(() => loading.remove(), 600);

    renderer.domElement.style.cursor = 'grab';
  },

  undefined,

  error => {
    console.error(error);

    loading.innerHTML =
      '<span>Não foi possível carregar Cine.glb.</span><span>Confira public/models/Cine.glb.</span>';
  }
);

// ======================================================
// ENTRADA NO CINEMA
// ======================================================

function enterCinema() {
  entered = true;

  welcome.classList.add('hidden');
  hint.classList.add('visible');

  renderer.domElement.requestPointerLock?.();

  setTimeout(() => {
    hint.classList.remove('visible');
  }, 5500);
}

renderer.domElement.addEventListener('click', () => {
  if (
    entered &&
    document.pointerLockElement !== renderer.domElement
  ) {
    renderer.domElement.requestPointerLock?.();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked =
    document.pointerLockElement === renderer.domElement;

  renderer.domElement.style.cursor = locked ? 'none' : 'grab';

  if (entered && !locked) {
    hint.classList.add('visible');

    setTimeout(() => {
      hint.classList.remove('visible');
    }, 3500);
  }
});

// ======================================================
// MOVIMENTAÇÃO DA CÂMERA
// ======================================================

document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== renderer.domElement) return;

  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;

  yaw = THREE.MathUtils.clamp(
    yaw,
    -Math.PI * 2,
    Math.PI * 2
  );

  pitch = THREE.MathUtils.clamp(pitch, -1, 1);

  updateCamera();
});

// ======================================================
// CONTROLES EXISTENTES
// ======================================================

a$('#enterBtn')?.addEventListener('click', enterCinema);

a$('#movieBtn')?.addEventListener('click', () => {
  panel.classList.toggle('open');
});

a$('#closePanel')?.addEventListener('click', () => {
  panel.classList.remove('open');
});

a$('#videoForm')?.addEventListener('submit', event => {
  event.preventDefault();

  const value = $('#videoUrl').value;

  if (value) {
    loadVideoLink(value);
  } else {
    message.textContent = 'Cole primeiro o link do vídeo.';
  }
});

a$('#videoFile')?.addEventListener('change', event => {
  loadLocalFile(event.target.files?.[0]);
});

a$('#fullscreenBtn')?.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await app.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showToast('O navegador não permitiu abrir a tela cheia.');
  }
});

// ======================================================
// CONTROLES DE PLAY / PAUSE
// ======================================================

a$('#playPauseBtn')?.addEventListener('click', async () => {
  const hasYT = youtubeReady && youtubePlayer;

  if (!videoElement && !hasYT) {
    return showToast('Aguarde o player terminar de carregar.');
  }

  // Convidados não controlam o estado oficial da sala.
  if (currentRoom && !isHost()) {
    try {
      if (hasYT) {
        youtubePlayer.playVideo();
      } else {
        await videoElement.play();
      }
    } catch {
      showToast('O navegador bloqueou a reprodução. Tente novamente.');
    }

    return;
  }

  try {
    if (hasYT) {
      const state = youtubePlayer.getPlayerState();

      const isPlaying =
        state === window.YT.PlayerState.PLAYING;

      if (isPlaying) {
        youtubePlayer.pauseVideo();
      } else {
        youtubePlayer.playVideo();
      }

    } else if (videoElement.paused) {
      await videoElement.play();

      await publishPlayback('playing', undefined, true);

    } else {
      videoElement.pause();

      await publishPlayback('paused', undefined, true);
    }

  } catch (error) {
    showToast(
      `Não foi possível alterar a reprodução: ${error.message}`
    );
  }
});

// ======================================================
// BARRA DE TEMPO
// ======================================================

a$('#seekBar')?.addEventListener('pointerdown', () => {
  isSeeking = true;
});

a$('#seekBar')?.addEventListener('pointerup', () => {
  isSeeking = false;
});

a$('#seekBar')?.addEventListener('input', event => {
  if (
    (!videoElement && !(youtubeReady && youtubePlayer)) ||
    (currentRoom && !isHost())
  ) {
    return;
  }

  const value = Number(event.target.value);

  if (Number.isFinite(value)) {
    if (youtubeReady && youtubePlayer) {
      youtubePlayer.seekTo(value, true);
    } else {
      videoElement.currentTime = value;
    }
  }
});

a$('#seekBar')?.addEventListener('change', async () => {
  isSeeking = false;

  if (
    (!videoElement && !(youtubeReady && youtubePlayer)) ||
    (currentRoom && !isHost())
  ) {
    return;
  }

  const status = youtubeReady && youtubePlayer
    ? (
        youtubePlayer.getPlayerState() ===
        window.YT.PlayerState.PLAYING
          ? 'playing'
          : 'paused'
      )
    : (
        videoElement.paused
          ? 'paused'
          : 'playing'
      );

  await publishPlayback(status, undefined, true);
});

// ======================================================
// CONTROLES MULTIPLAYER
// ======================================================

a$('#openRoomBtn')?.addEventListener('click', () => {
  $('#roomGate').hidden = false;
  $('#roomGate').classList.add('open');
});

a$('#closeRoomGate')?.addEventListener('click', () => {
  $('#roomGate').classList.remove('open');
  $('#roomGate').hidden = true;
});

a$('#createRoomBtn')?.addEventListener('click', createRoom);

a$('#joinRoomBtn')?.addEventListener('click', joinRoom);

a$('#leaveRoomBtn')?.addEventListener('click', leaveRoom);

a$('#copyCodeBtn')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentRoom.code);

    showToast('Código copiado!');

  } catch {
    showToast(`Código da sala: ${currentRoom.code}`);
  }
});

a$('#micBtn')?.addEventListener('click', () => {
  localStream ? stopVoice() : startVoice();
});

a$('#roomMovieBtn')?.addEventListener('click', () => {
  if (!isHost()) {
    return showToast('Somente o anfitrião pode escolher o vídeo.');
  }

  panel.classList.toggle('open');
});

// ======================================================
// INTERFACE DE REPRODUÇÃO
// ======================================================

function updatePlaybackUI() {
  const button = $('#playPauseBtn');
  const seek = $('#seekBar');

  if (!button || !seek) return;

  const hasYT = !!(youtubeReady && youtubePlayer);
  const hasDirectVideo = !!videoElement;

  const hasMedia = hasYT || hasDirectVideo;

  const canControlSeek =
    hasMedia && (!currentRoom || isHost());

  button.disabled = !hasMedia;
  seek.disabled = !canControlSeek;

  let playing = false;

  if (hasYT) {
    playing =
      youtubePlayer.getPlayerState() ===
      window.YT.PlayerState.PLAYING;

  } else if (hasDirectVideo) {
    playing = !videoElement.paused;
  }

  button.textContent = playing
    ? 'Ⅱ PAUSAR'
    : '▶ REPRODUZIR';

  if (!hasMedia) {
    seek.min = '0';
    seek.max = '100';
    seek.value = '0';

    return;
  }

  const duration = hasYT
    ? Number(youtubePlayer.getDuration() || 0)
    : videoElement.duration;

  const currentTime = hasYT
    ? Number(youtubePlayer.getCurrentTime() || 0)
    : videoElement.currentTime;

  seek.min = '0';
  seek.step = '0.1';

  if (Number.isFinite(duration) && duration > 0) {
    seek.max = String(duration);
  }

  if (!isSeeking && Number.isFinite(currentTime)) {
    seek.value = String(currentTime);
  }
}

// ======================================================
// UTILITÁRIOS
// ======================================================

function a$(selector) {
  return document.querySelector(selector);
}

// ======================================================
// REDIMENSIONAMENTO
// ======================================================

function resize() {
  camera.aspect = innerWidth / innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(innerWidth, innerHeight);
  cssRenderer.setSize(innerWidth, innerHeight);
}

window.addEventListener('resize', resize);

// ======================================================
// ENCERRAMENTO
// ======================================================

window.addEventListener('beforeunload', () => {
  clearInterval(heartbeatTimer);
  clearInterval(youtubeSyncTimer);

  stopVoice();

  if (localObjectUrl) {
    URL.revokeObjectURL(localObjectUrl);
  }
});

// ======================================================
// ANIMAÇÃO PRINCIPAL
// ======================================================

function animate() {
  requestAnimationFrame(animate);

  renderer.render(scene, camera);
  cssRenderer.render(scene, camera);
}

animate();
