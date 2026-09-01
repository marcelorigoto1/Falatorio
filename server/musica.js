/**
 * Fila de música da sala.
 *
 * A ideia é a de um "bot", mas sem os problemas dele: o servidor não toca
 * nem transmite áudio nenhum. Ele só guarda O QUE está tocando e EM QUE
 * SEGUNDO, e cada pessoa reproduz o mesmo trecho no player oficial do
 * YouTube. Isso mantém a qualidade original, não gasta o upload de ninguém,
 * e não depende de baixar áudio de lugar nenhum — que foi exatamente o que
 * derrubou os bots de música do Discord em 2021.
 */
const CHAVE = () => String(process.env.YOUTUBE_API_KEY || '').trim();
const MAX_FILA = 50;

const estado = {
  atual: null,      // { id, videoId, titulo, canal, duracao, por }
  fila: [],
  pausado: false,
  posicao: 0,       // segundos já tocados do item atual
  desde: Date.now(),// instante do último ajuste de posição
};

let proximoId = 1;

/** Onde a música está agora, considerando o tempo que passou. */
function posicaoAtual() {
  if (!estado.atual) return 0;
  if (estado.pausado) return estado.posicao;
  return estado.posicao + (Date.now() - estado.desde) / 1000;
}

function publico() {
  return {
    atual: estado.atual,
    fila: estado.fila,
    pausado: estado.pausado,
    posicao: Number(posicaoAtual().toFixed(2)),
  };
}

function fixarPosicao(segundos) {
  estado.posicao = Math.max(0, segundos);
  estado.desde = Date.now();
}

// ── Operações ─────────────────────────────────────────────
function adicionar(item, porNome) {
  if (estado.fila.length >= MAX_FILA) return { erro: 'A fila está cheia.' };

  const entrada = {
    id: proximoId++,
    videoId: String(item.videoId).slice(0, 20),
    titulo: String(item.titulo || 'Sem título').slice(0, 140),
    canal: String(item.canal || '').slice(0, 80),
    duracao: Number(item.duracao) || 0,
    por: String(porNome || '').slice(0, 24),
  };

  if (!estado.atual) {
    estado.atual = entrada;
    estado.pausado = false;
    fixarPosicao(0);
  } else {
    estado.fila.push(entrada);
  }
  return { ok: true, entrada };
}

function pular() {
  const proximo = estado.fila.shift() || null;
  estado.atual = proximo;
  estado.pausado = false;
  fixarPosicao(0);
  return publico();
}

function pausar(valor) {
  if (!estado.atual) return publico();
  const novo = !!valor;
  if (novo === estado.pausado) return publico();
  fixarPosicao(posicaoAtual());  // congela onde está
  estado.pausado = novo;
  return publico();
}

function irPara(segundos) {
  if (!estado.atual) return publico();
  fixarPosicao(Number(segundos) || 0);
  return publico();
}

function remover(id) {
  estado.fila = estado.fila.filter((x) => x.id !== Number(id));
  return publico();
}

function limpar() {
  estado.fila = [];
  estado.atual = null;
  estado.pausado = false;
  fixarPosicao(0);
  return publico();
}

/** Alguém avisou que o vídeo acabou; só vale para o que está tocando. */
function terminou(videoId) {
  if (!estado.atual || estado.atual.videoId !== videoId) return null;
  // Evita pular por engano quando o aviso chega repetido/atrasado.
  if (estado.atual.duracao && posicaoAtual() < estado.atual.duracao - 5) return null;
  return pular();
}

// ── Busca no YouTube ──────────────────────────────────────
const REGEX_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/;

function extrairId(texto) {
  const m = REGEX_ID.exec(String(texto).trim());
  return m ? (m[1] || m[2]) : null;
}

/** Converte a duração ISO do YouTube (PT3M12S) em segundos. */
function duracaoEmSegundos(iso) {
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

/** Link colado: dá para pegar título e canal sem chave de API nenhuma. */
async function porLink(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    return [{ videoId, titulo: j.title, canal: j.author_name, duracao: 0 }];
  } catch {
    return [{ videoId, titulo: 'Vídeo do YouTube', canal: '', duracao: 0 }];
  }
}

async function buscar(termo) {
  const texto = String(termo || '').trim().slice(0, 120);
  if (!texto) return { erro: 'Escreva o nome da música.' };

  const id = extrairId(texto);
  if (id) return { resultados: await porLink(id) };

  if (!CHAVE()) {
    return {
      erro: 'A busca por nome precisa de uma chave do YouTube no servidor '
          + '(YOUTUBE_API_KEY). Enquanto isso, cole o link do vídeo que funciona.',
    };
  }

  try {
    const busca = new URL('https://www.googleapis.com/youtube/v3/search');
    busca.search = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',   // só o que dá para tocar fora do YouTube
      maxResults: '5',
      q: texto,
      key: CHAVE(),
    }).toString();

    const r = await fetch(busca, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      const detalhe = r.status === 403 ? 'cota da API esgotada ou chave inválida' : `erro ${r.status}`;
      return { erro: `A busca falhou (${detalhe}).` };
    }
    const dados = await r.json();
    const itens = (dados.items || []).filter((x) => x.id && x.id.videoId);
    if (!itens.length) return { resultados: [] };

    // Segunda chamada só para saber a duração de cada um (custa 1 unidade).
    const ids = itens.map((x) => x.id.videoId).join(',');
    let duracoes = {};
    try {
      const det = new URL('https://www.googleapis.com/youtube/v3/videos');
      det.search = new URLSearchParams({ part: 'contentDetails', id: ids, key: CHAVE() }).toString();
      const rd = await fetch(det, { signal: AbortSignal.timeout(6000) });
      if (rd.ok) {
        const dd = await rd.json();
        (dd.items || []).forEach((v) => {
          duracoes[v.id] = duracaoEmSegundos(v.contentDetails && v.contentDetails.duration);
        });
      }
    } catch { /* sem duração, não é grave */ }

    return {
      resultados: itens.map((x) => ({
        videoId: x.id.videoId,
        titulo: (x.snippet.title || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        canal: x.snippet.channelTitle || '',
        duracao: duracoes[x.id.videoId] || 0,
      })),
    };
  } catch (err) {
    return { erro: `A busca falhou: ${err.message}` };
  }
}

module.exports = {
  publico, adicionar, pular, pausar, irPara, remover, limpar, terminou,
  buscar, extrairId, temChave: () => !!CHAVE(),
};
