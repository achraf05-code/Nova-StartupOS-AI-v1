/* =====================================================================
   Nova StartupOS AI - AI engine (NovaAI)
   OpenRouter integration with streaming + a deterministic demo-mode
   fallback so the product works investor-demo-ready with no API key.

   SECURITY NOTE: For production, proxy OpenRouter through a backend so
   the API key is never exposed to the browser. The client-side key here
   is a convenience for local/MVP use and is stored only in localStorage.
   ===================================================================== */
(function (global) {
  'use strict';

  var ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

  var SYSTEM_PROMPT =
    "You are Nova, an AI co-founder inside Nova StartupOS AI, a platform that helps " +
    "founders turn ideas into investment-ready startups. You help with business plans, " +
    "pitch decks, startup readiness, fundraising strategy, and startup-visa guidance. " +
    "Be concise, structured, practical, and encouraging. Prefer short paragraphs and " +
    "bullet points. When asked to produce documents, use clear section headings.";

  function buildSystemPrompt(context) {
    var s = SYSTEM_PROMPT;
    if (context && context.startup) {
      var st = context.startup;
      s += "\n\nActive startup context:\n";
      s += "- Name: " + (st.name || 'n/a') + "\n";
      s += "- Industry: " + (st.industry || 'n/a') + "\n";
      s += "- Country: " + (st.country || 'n/a') + "\n";
      s += "- Target market: " + (st.market || 'n/a') + "\n";
      s += "- Problem: " + (st.problem || 'n/a') + "\n";
      s += "- Solution: " + (st.solution || 'n/a') + "\n";
      s += "- Stage: " + (st.stage || 'n/a') + ", Readiness score: " + (st.score || 0) + "/100";
    }
    if (context && context.memory && context.memory.length) {
      s += "\n\nDurable project memory (always honor these facts):\n";
      s += context.memory.map(function (m) { return "- " + m.text; }).join("\n");
    }
    return s;
  }

  function isConfigured() {
    var st = global.NovaStore ? NovaStore.getSettings() : {};
    return !!(st.apiKey && !st.demoMode);
  }

  /* --------------- SECURE EDGE FUNCTION STREAMING ------------------ */
  // Resolve the configured default model from the store, with a safe fallback.
  function defaultModel() {
    try {
      if (global.NovaStore && typeof NovaStore.get === 'function') {
        var m = NovaStore.get('default_model');
        if (m) return m;
      }
      if (global.NovaStore && typeof NovaStore.getSettings === 'function') {
        var s = NovaStore.getSettings();
        if (s && s.model) return s.model;
      }
    } catch (e) { /* ignore */ }
    return 'google/gemini-flash-1.5';
  }

  /**
   * Stream an AI generation through the secure Supabase Edge Function.
   * No API key ever touches the browser; auth is the user's Supabase JWT.
   *
   * @param {string}   prompt        The user prompt / instruction.
   * @param {string}   systemPrompt  System instruction for the model.
   * @param {function} onChunk       Called with each text delta as it streams.
   * @param {function} onDone        Called once with the full text when complete.
   * @param {function} onError       Called with an Error on any failure.
   * @param {Object}   [opts]        Optional { signal } AbortSignal.
   */
  async function generateStream(prompt, systemPrompt, onChunk, onDone, onError, opts) {
    opts = opts || {};
    try {
      var sb = global.NovaApi && NovaApi.supabase;
      var baseUrl = global.NovaApi && NovaApi.SUPABASE_URL;
      if (!sb || !baseUrl) throw new Error('Supabase client is not initialized.');

      // Fetch the active session token; bail out cleanly if not signed in.
      var sessionRes = await sb.auth.getSession();
      var token = sessionRes && sessionRes.data && sessionRes.data.session
        ? sessionRes.data.session.access_token : null;
      if (!token) { if (onError) onError(new Error('No active session. Please log in.')); return; }

      var res = await fetch(baseUrl + '/functions/v1/nova-ai-stream', {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          prompt: prompt,
          systemPrompt: systemPrompt,
          model: defaultModel(),
        }),
      });

      if (!res.ok || !res.body) {
        var errTxt = await safeText(res);
        throw new Error('AI stream failed (' + res.status + '): ' + errTxt);
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var full = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            var json = JSON.parse(data);
            var delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (delta) { full += delta; if (onChunk) onChunk(delta); }
          } catch (e) { /* partial JSON split across chunks; ignore */ }
        }
      }
      if (onDone) onDone(full);
      return full;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (onError) onError(e);
    }
  }

  /**
   * Send a chat completion.
   * @param {Array} messages  [{role, content}]
   * @param {Object} opts      { context, onToken(textDelta), signal }
   * @returns {Promise<string>} full assistant text
   */
  async function chat(messages, opts) {
    opts = opts || {};
    var settings = global.NovaStore ? NovaStore.getSettings() : { demoMode: true };
    var system = { role: 'system', content: buildSystemPrompt(opts.context) };

    if (!settings.apiKey || settings.demoMode) {
      return demoChat(messages, opts);
    }

    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey,
          'HTTP-Referer': location.origin || 'https://novastartupos.ai',
          'X-Title': 'Nova StartupOS AI'
        },
        body: JSON.stringify({
          model: settings.model || 'openai/gpt-4o-mini',
          stream: true,
          messages: [system].concat(messages)
        })
      });

      if (!res.ok || !res.body) {
        var errTxt = await safeText(res);
        throw new Error('OpenRouter ' + res.status + ': ' + errTxt);
      }
      return await readStream(res.body, opts.onToken);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn('NovaAI: falling back to demo mode —', e.message);
      // graceful degradation: never break the demo
      return demoChat(messages, Object.assign({ degraded: true }, opts));
    }
  }

  async function safeText(res) { try { return (await res.text()).slice(0, 300); } catch (e) { return res.statusText; } }

  async function readStream(body, onToken) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var full = '';
    var buffer = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.indexOf('data:') !== 0) continue;
        var data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          var json = JSON.parse(data);
          var delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) { full += delta; if (onToken) onToken(delta); }
        } catch (e) { /* partial json across chunks; ignore */ }
      }
    }
    return full;
  }

  /* ----------------------- DEMO MODE (offline) ----------------------- */
  // Streams a contextual, deterministic response token-by-token so the UX
  // is identical to live mode during investor demos.
  async function demoChat(messages, opts) {
    var last = '';
    for (var i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { last = messages[i].content; break; } }
    var text = demoReply(last, opts && opts.context);
    if (opts && opts.onToken) {
      var words = text.split(/(\s+)/);
      for (var w = 0; w < words.length; w++) {
        await sleep(12);
        opts.onToken(words[w]);
      }
    }
    return text;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function demoReply(msg, context) {
    var m = (msg || '').toLowerCase();
    var name = context && context.startup ? context.startup.name : 'your startup';
    if (m.indexOf('delivery') >= 0 || m.indexOf('morocco') >= 0) {
      return "A delivery startup in Morocco is a strong, timely idea. Here's how I'd frame it:\n\n" +
        "Problem: Last-mile delivery is fragmented and unreliable for SMEs.\n" +
        "Wedge: Start with one city (Casablanca) and one vertical (pharmacy or food).\n" +
        "Moat: Local payment support (cash-on-delivery + mobile money) and a rider network.\n\n" +
        "Next steps:\n• Open Business Plans and I'll draft the full plan.\n• Run the Readiness Assessment to find gaps before pitching.\n• Check the Visa Assistant — France and Estonia score well for relocation.";
    }
    if (m.indexOf('saas') >= 0 || m.indexOf('business plan') >= 0) {
      return "I can generate a complete SaaS business plan for " + name + ": Executive Summary, Market Analysis, Business Model, SWOT, and Growth Strategy.\n\nOpen the Business Plans module, confirm the details, and click Generate. Each section will be written in investor-ready format you can export to PDF or DOCX.";
    }
    if (m.indexOf('investor') >= 0 || m.indexOf('fund') >= 0 || m.indexOf('raise') >= 0) {
      return "To get investor-ready:\n\n1. Run the Readiness Assessment to score Innovation, Scalability, Market, and Investment readiness.\n2. Generate your 10-slide pitch deck (Problem → Funding Ask).\n3. Add 3-year financials and clear unit economics.\n4. Use the Funding Assistant to match accelerators and VCs by fit.\n\nWant me to start with the assessment?";
    }
    if (m.indexOf('analy') >= 0 || m.indexOf('idea') >= 0) {
      return "Let's analyze " + name + ". Tell me:\n• The core problem and who has it\n• Your industry and target country\n• How you make money\n\nWith that, I'll score readiness and draft your plan and deck.";
    }
    if (m.indexOf('pitch') >= 0 || m.indexOf('deck') >= 0) {
      return "I'll build a full investor pitch deck: Problem, Solution, Market, Product, Business Model, Competition, Traction, Team, Financials, and the Funding Ask. Open Pitch Decks and click Generate — then export to PPTX.";
    }
    if (m.indexOf('visa') >= 0 || m.indexOf('relocat') >= 0) {
      return "The Visa Assistant ranks startup-visa programs across 60+ countries. Top matches: France (French Tech Visa), Estonia (Startup Visa), Canada (Start-up Visa with PR), and Lithuania (Startup Visa — fast-track for non-EU founders). Open it to see eligibility.";
    }
    if (m.indexOf('lithuania') >= 0) {
      return "Startup Lithuania offers a Startup Visa for non-EU founders with an innovative, scalable business. Evaluation weighs innovation, scalability, team, and traction. I can prepare your submission narrative and align your readiness score to their criteria — open the Readiness Assessment and Business Plans modules and I'll guide you.";
    }
    return "As your AI co-founder I can help with business plans, pitch decks, readiness assessments, and funding & visa strategy for " + name + ". Tell me the problem you solve, your market, and your stage, and I'll guide the next step.";
  }

  global.NovaAI = {
    chat: chat,
    generateStream: generateStream,
    isConfigured: isConfigured,
    buildSystemPrompt: buildSystemPrompt,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    MODELS: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
      { id: 'openai/gpt-4o', label: 'GPT-4o (high quality)' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'google/gemini-flash-1.5', label: 'Gemini 1.5 Flash' },
      { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' }
    ]
  };
})(window);
