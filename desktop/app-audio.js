/**
 * Captura do som de UM aplicativo (Windows).
 *
 * O navegador não sabe fazer isso: ele só entrega o som de uma guia ou a
 * mistura do sistema inteiro. Quem sabe separar por programa é o próprio
 * Windows, através da "Application Loopback API" (Windows 10 build 2004+),
 * a mesma que o OBS usa no "Application Audio Capture".
 *
 * Toda a parte nativa está isolada aqui dentro. Se a biblioteca não carregar
 * — outro sistema, Windows antigo, binário incompatível — o resto do app
 * continua funcionando normalmente e a opção some da interface.
 */
const os = require('os');
const { execFile } = require('child_process');

const FORMATO = { taxa: 48000, canais: 2, bits: 16 }; // o que a captura entrega

/** Modo de teste: gera um tom no lugar da captura real, para validar o caminho. */
const FAKE = process.env.FALATORIO_FAKE_PCM === '1';

let nativo = null;
let motivoIndisponivel = '';

if (FAKE) {
  motivoIndisponivel = '';
} else if (os.platform() !== 'win32') {
  motivoIndisponivel = 'A captura por aplicativo só existe no Windows.';
} else if (os.arch() !== 'x64') {
  motivoIndisponivel = 'A captura por aplicativo precisa de Windows 64 bits.';
} else {
  try {
    // eslint-disable-next-line global-require
    nativo = require('loopback-capture');
    if (!nativo || !nativo.LoopbackCapture) {
      nativo = null;
      motivoIndisponivel = 'A biblioteca de captura carregou incompleta.';
    }
  } catch (err) {
    nativo = null;
    motivoIndisponivel = `Não consegui carregar a captura por aplicativo: ${err.message}`;
  }
}

const disponivel = () => FAKE || !!nativo;

/**
 * Aplicativos candidatos: processos com janela visível, que é o que a pessoa
 * reconhece na hora de escolher. O PID vem junto para a captura.
 */
function listarAplicativos() {
  if (FAKE) {
    return Promise.resolve([
      { pid: 1234, nome: 'jogo-de-teste.exe', titulo: 'Jogo de teste' },
    ]);
  }
  if (os.platform() !== 'win32') return Promise.resolve([]);

  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH', '/V'], { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);

        const vistos = new Set();
        const lista = [];

        for (const linha of stdout.split(/\r?\n/)) {
          const campos = dividirCSV(linha);
          if (campos.length < 9) continue;

          const nome = campos[0];
          const pid = Number(campos[1]);
          const titulo = campos[8];

          // Sem janela, a pessoa não teria como reconhecer o programa.
          if (!pid || !titulo || titulo === 'N/A' || titulo === 'Sem título') continue;
          if (/^(tasklist|conhost|dwm|explorer)\.exe$/i.test(nome)) continue;

          const chave = `${nome}|${titulo}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);

          lista.push({ pid, nome, titulo });
        }

        lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
        resolve(lista);
      });
  });
}

/** Divide uma linha do CSV do tasklist respeitando as aspas. */
function dividirCSV(linha) {
  const campos = [];
  let atual = '';
  let dentro = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else dentro = !dentro;
    } else if (c === ',' && !dentro) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

// ── Captura em andamento ────────────────────────────────────
let captura = null;
let timerFalso = null;
let faseDoTom = 0;

function iniciar(pid, aoReceber) {
  parar();

  if (FAKE) {
    // Tom contínuo de 440 Hz, no mesmo formato da captura real: serve para
    // testar todo o caminho (IPC, worklet, WebRTC) sem depender do Windows.
    const quadrosPorPacote = 480; // 10 ms
    timerFalso = setInterval(() => {
      const buf = Buffer.alloc(quadrosPorPacote * FORMATO.canais * 2);
      for (let i = 0; i < quadrosPorPacote; i++) {
        const amostra = Math.round(Math.sin(faseDoTom) * 8000);
        faseDoTom += (2 * Math.PI * 440) / FORMATO.taxa;
        buf.writeInt16LE(amostra, i * 4);
        buf.writeInt16LE(amostra, i * 4 + 2);
      }
      aoReceber(buf);
    }, 10);
    return { ok: true, formato: FORMATO };
  }

  if (!nativo) return { ok: false, erro: motivoIndisponivel };

  try {
    captura = new nativo.LoopbackCapture();
    captura.start(Number(pid), true, (chunk) => aoReceber(chunk));
    return { ok: true, formato: FORMATO };
  } catch (err) {
    captura = null;
    return { ok: false, erro: `A captura do aplicativo falhou: ${err.message}` };
  }
}

function parar() {
  if (timerFalso) { clearInterval(timerFalso); timerFalso = null; }
  if (captura) {
    try { captura.stop(); } catch { /* já parada */ }
    captura = null;
  }
}

module.exports = {
  FORMATO,
  disponivel,
  motivo: () => motivoIndisponivel,
  listarAplicativos,
  iniciar,
  parar,
};
