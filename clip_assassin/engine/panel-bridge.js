(function(root) {
  'use strict';
  function call(csi, name, args) {
    if (!/^qc[A-Za-z0-9_]+$/.test(name)) return Promise.reject(new Error('Função do host inválida.'));
    const script = name + '(' + (args || []).map(x => JSON.stringify(x).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')).join(',') + ')';
    return new Promise(function(resolve,reject) {
      try {
        csi.evalScript(script, function(raw) {
          if (typeof raw !== 'string' || !raw || /^ERROR:|^EvalScript error/i.test(raw)) return reject(new Error(raw || 'Premiere não retornou resultado.'));
          if (/^(OK|SUCCESS):/.test(raw)) return resolve(raw.substring(raw.indexOf(':')+1));
          try {
            const result = JSON.parse(raw);
            if (!result || result.ok !== true) throw new Error(result && result.error || 'Resposta do Premiere sem confirmação de sucesso.');
            resolve(result.data);
          } catch(e) { reject(e); }
        });
      } catch(e) { reject(e); }
    });
  }
  root.QuarksHostBridge = {call:call};
  if (typeof module !== 'undefined' && module.exports) module.exports = {call:call};
})(typeof window !== 'undefined' ? window : global);
