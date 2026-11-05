# PRIVATE CINEMA

Projeto inicial do cinema 3D com o modelo `Cine.glb`.

## Requisitos
- Node.js 22 ou superior
- Navegador atualizado (Chrome, Edge ou Firefox)

## Como executar
1. Extraia o ZIP.
2. Abra a pasta `private-cinema` no VS Code.
3. Abra o terminal nessa pasta.
4. (Opcional, para multiplayer) Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os dados do seu projeto Supabase. O modo solo não precisa dessas variáveis.
5. Execute:

```bash
npm install
npm run dev
```

6. Abra o endereço local exibido pelo Vite (normalmente `http://localhost:5173`).

## Controles
- Clique em **ENTRAR NO CINEMA**.
- Mova o mouse para olhar ao redor.
- Pressione `ESC` para liberar o mouse.
- Clique em **ESCOLHER VÍDEO** para colar um link ou selecionar um arquivo local.
- Use o botão ⛶ para tela cheia.

## Vídeos
- YouTube: links comuns de vídeo, Shorts e youtu.be.
- Vimeo: links de vídeos públicos que permitam incorporação.
- MP4 / WebM / OGG: links diretos de arquivos.
- Arquivo local: selecione um vídeo do computador.

Alguns sites bloqueiam incorporação. Links diretos externos precisam permitir CORS para que o navegador use o vídeo como textura 3D. O YouTube e o Vimeo são exibidos por seus players incorporados, não como textura WebGL.

## Ajuste da câmera e do telão
No início de `src/main.js`, ajuste:
- `CAMERA_START`: posição da câmera sentada.
- `LOOK_AT_START`: direção inicial do olhar.
- `SCREEN_CENTER`, `SCREEN_WIDTH`, `SCREEN_HEIGHT`: posição e tamanho do player no telão.
- `SCREEN_NAME`: nome do objeto que recebe o vídeo (no arquivo atual: `Screen`).

O posicionamento inicial foi estimado pela geometria do GLB e pode precisar de pequenos ajustes depois de testar visualmente no navegador.


## Configuração do multiplayer

O multiplayer depende de funções RPC, tabelas, políticas RLS, Realtime e autenticação anônima configuradas no Supabase. Essas definições precisam existir no projeto Supabase; este repositório não contém o SQL de instalação. Não exponha uma chave `service_role` no frontend. Use somente a chave pública `anon` e configure políticas RLS e validações nas funções do banco.
