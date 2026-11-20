// The MCP Apps view (SEP-1865, spec 2026-01-26): one HTML resource that renders any of the four tools' results
// inside the chat (Claude web/desktop, ChatGPT and other MCP Apps hosts). No SDK and no external requests:
// it talks to the host over postMessage JSON-RPC (ui/initialize -> ui/notifications/initialized ->
// ui/notifications/tool-result) and falls back to window.openai.toolOutput where only that exists.
// Hosts that do not support MCP Apps ignore it and show the tool's text content.

export const VIEW_URI = "ui://giannis-builds/result-view-v1.html";
export const VIEW_MIME = "text/html;profile=mcp-app";

export const VIEW_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Result</title>
<style>
:root{--bg:var(--color-background-primary,#ffffff);--fg:var(--color-text-primary,#14161a);--mute:var(--color-text-secondary,#5b6270);
--line:var(--color-border-primary,#e3e6eb);--accent:#2b59ff;--ok:#127a3e;--bad:#b42318;--warn:#9a6700;--chip:rgba(43,89,255,.08);
--font:var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:var(--color-background-primary,#14161a);--fg:var(--color-text-primary,#eef0f3);--mute:var(--color-text-secondary,#a3abb8);--line:var(--color-border-primary,#2c313a);--accent:#7c9bff;--ok:#5fd08a;--bad:#ff8a80;--warn:#f2c14e;--chip:rgba(124,155,255,.12)}}
:root[data-theme=dark]{--bg:var(--color-background-primary,#14161a);--fg:var(--color-text-primary,#eef0f3);--mute:var(--color-text-secondary,#a3abb8);--line:var(--color-border-primary,#2c313a);--accent:#7c9bff;--ok:#5fd08a;--bad:#ff8a80;--warn:#f2c14e;--chip:rgba(124,155,255,.12)}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 var(--font)}
main{padding:14px 16px 16px;max-width:720px}
h1{font-size:15px;margin:0 0 4px}p{margin:6px 0}.mute{color:var(--mute);font-size:12.5px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--chip);color:var(--accent);margin-right:6px}
.badge.ok{color:var(--ok)}.badge.bad{color:var(--bad)}.badge.warn{color:var(--warn)}
.bars{display:grid;gap:8px;margin:12px 0}.bar{display:grid;grid-template-columns:64px 1fr 96px;align-items:center;gap:8px}
.track{height:10px;border-radius:5px;background:var(--line);overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:5px}
.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}th,td{text-align:left;padding:6px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--mute);font-size:12px}td.n{text-align:right;font-variant-numeric:tabular-nums}
.pass{color:var(--ok)}.fail,.unknown{color:var(--bad)}.not_checked{color:var(--mute)}
code{display:block;white-space:pre-wrap;word-break:break-all;background:var(--chip);padding:8px;border-radius:6px;font-size:12px;margin-top:8px}
a{color:var(--accent)}.empty{color:var(--mute)}
</style></head>
<body><main id="root"><p class="empty">Waiting for the tool result…</p></main>
<script>
(function(){
  var root=document.getElementById("root"),nextId=1,pending={};
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
  function usd(n){return n==null?"–":"USD "+Math.round(n).toLocaleString("en-US")}
  function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}
  function request(method,params){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},4000)})}
  function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
  function sizeChanged(){notify("ui/notifications/size-changed",{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})}
  function applyHost(ctx){if(!ctx)return;var v=ctx.styles&&ctx.styles.variables;if(v)for(var k in v){if(v[k])document.documentElement.style.setProperty(k,v[k])}
    if(ctx.theme)document.documentElement.setAttribute("data-theme",ctx.theme)}
  function checkout(d){var m=d.monthly_usd,max=m?Math.max(m.high,1):1;
    var bars=m?["low","likely","high"].map(function(k){return '<div class="bar"><span class="mute">'+k+'</span><div class="track"><div class="fill" style="width:'+Math.max(2,Math.round(m[k]/max*100))+'%"></div></div><span class="num">'+usd(m[k])+'</span></div>'}).join(""):"";
    return '<h1>Abandoned-checkout flow, a month</h1><p><span class="badge">'+esc(d.verdict)+'</span><span class="mute">'+esc(d.benchmark.revenue_band)+', AOV '+esc(d.benchmark.aov_row)+'</span></p>'+
      '<div class="bars">'+bars+'</div><p>'+esc(d.summary)+'</p>'+(d.yearly_usd?'<p class="mute">A year: '+usd(d.yearly_usd.low)+' to '+usd(d.yearly_usd.high)+'. '+esc(d.counts.abandoned.toLocaleString("en-US"))+' abandoned checkouts, '+esc(d.counts.emails_delivered.toLocaleString("en-US"))+' emails delivered.</p>':"")}
  function toolcost(d){var rows=d.comparisons.map(function(r){return '<tr><td>'+esc(r.tool)+' '+esc(r.plan)+'</td><td class="n">'+usd(r.saas_usd_per_month)+(r.saas_cost_is_floor?"+":"")+'</td><td class="n">'+usd(r.saas_total_usd)+'</td><td class="n">'+usd(r.custom_total_usd)+'</td><td class="n">'+(r.break_even_month==null?"never":"month "+r.break_even_month)+'</td></tr>'}).join("");
    return '<h1>'+esc(d.team_size)+' people, '+esc(d.months)+' months</h1><p class="mute">Custom: '+esc(d.custom.tier)+', '+usd(d.custom.usd)+' once, on '+esc(d.custom.runs_on)+'.</p>'+
      '<table><thead><tr><th>SaaS plan</th><th>a month</th><th>SaaS total</th><th>Custom total</th><th>Break-even</th></tr></thead><tbody>'+rows+'</tbody></table><p>'+esc(d.summary)+'</p>'}
  function preview(d){var cls=d.verdict==="fail"?"bad":"ok";
    var rows=d.checks.map(function(r){return '<tr><td>'+esc(r.check)+'</td><td>'+esc(r.measured)+'</td><td class="'+esc(r.status)+'">'+esc(r.status.replace("_"," "))+'</td></tr>'}).join("");
    return '<h1>App Store preview check</h1><p><span class="badge '+cls+'">'+esc(d.verdict.replace(/_/g," "))+'</span>'+(d.display_size?'<span class="mute">'+d.display_size.width+' × '+d.display_size.height+'</span>':"")+'</p><p>'+esc(d.summary)+'</p>'+
      '<table><thead><tr><th>Check</th><th>Measured</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>'+(d.ffmpeg_fix_command?'<p class="mute">One command fixes what a re-encode can fix:</p><code>'+esc(d.ffmpeg_fix_command)+'</code>':"")}
  function services(d){var s=d.services.map(function(x){return '<h1>'+esc(x.name)+'</h1><ul>'+x.offers.map(function(o){return '<li>'+esc(o.name)+': <b>'+usd(o.price_usd)+'</b></li>'}).join("")+'</ul>'}).join("");
    var mcp=d.mcp_connector_build?'<h1>'+esc(d.mcp_connector_build.name)+'</h1><ul>'+d.mcp_connector_build.offers.map(function(o){return '<li>'+esc(o.name)+': <b>'+usd(o.price_usd)+'</b>, '+o.days+' days</li>'}).join("")+'</ul>':"";
    return mcp+s+'<p class="mute">'+esc(d.terms)+'</p>'}
  function render(result){
    var d=result&&(result.structuredContent||result);
    if(!d||!d.kind){var t=result&&result.content&&result.content[0]&&result.content[0].text;root.innerHTML=t?'<p>'+esc(t)+'</p>':'<p class="empty">No result.</p>';sizeChanged();return}
    if(d.ok===false){root.innerHTML='<h1>Check the input</h1><ul>'+Object.keys(d.errors||{}).map(function(k){return '<li><b>'+esc(k)+'</b>: '+esc(d.errors[k])+'</li>'}).join("")+'</ul>';sizeChanged();return}
    root.innerHTML=d.kind==="checkout"?checkout(d):d.kind==="toolcost"?toolcost(d):d.kind==="preview"?preview(d):d.kind==="services"?services(d):'<p>'+esc(d.summary)+'</p>';
    sizeChanged()}
  window.addEventListener("message",function(ev){var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
    if(m.id!=null&&pending[m.id]&&(m.result!==undefined||m.error!==undefined)){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
    if(m.method==="ui/notifications/tool-result")render(m.params);
    else if(m.method==="ui/notifications/host-context-changed")applyHost(m.params);
    else if(m.method==="ping"&&m.id!=null)post({jsonrpc:"2.0",id:m.id,result:{}})});
  request("ui/initialize",{appInfo:{name:"giannis-builds-mcp view",version:"1.0.0"},appCapabilities:{availableDisplayModes:["inline"]},protocolVersion:"2026-01-26"})
    .then(function(r){applyHost(r&&r.hostContext);notify("ui/notifications/initialized",{})})
    .catch(function(){if(window.openai&&window.openai.toolOutput)render(window.openai.toolOutput)});
  if(window.ResizeObserver)new ResizeObserver(sizeChanged).observe(document.documentElement);
})();
</script></body></html>`;
