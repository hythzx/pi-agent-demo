(() => {
  const el=id=>document.getElementById(id);
  const ns="http://www.w3.org/2000/svg";
  const state={sessionId:sessionStorage.getItem("nanjing-session")||newId(),busy:false,charts:0,tools:0};
  sessionStorage.setItem("nanjing-session",state.sessionId);
  function newId(){return typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"session-"+Date.now()+"-"+Math.floor(Math.random()*100000);}
  function notify(message){el("notice").textContent=message||"";}
  function bubble(role,text) {
    const node=document.createElement("div"); node.className="bubble "+role;
    const tag=document.createElement("span");tag.className="tag";tag.textContent=role==="user"?"YOUR QUESTION":"NANJING DATA AGENT";
    const md=role==="assistant";
    const body=document.createElement(md?"div":"span");if(md)body.className="md";
    body.textContent=text||"";
    node.append(tag,body);el("messages").append(node);el("messages").scrollTop=el("messages").scrollHeight;return body;
  }
  // 助手气泡渲染：marked 解析 + DOMPurify 消毒后 innerHTML；vendor 脚本缺失时退回纯文本。
  function renderMd(node,text){if(window.marked&&window.DOMPurify)node.innerHTML=DOMPurify.sanitize(marked.parse(text,{breaks:true}));else node.textContent=text;}
  function svg(tag,attrs,text) {
    const node=document.createElementNS(ns,tag);
    Object.entries(attrs||{}).forEach(([k,v])=>node.setAttribute(k,String(v)));
    if(text!==undefined)node.textContent=String(text);
    return node;
  }
  function chartNode(chart) {
    const points=chart.points||[];
    const card=document.createElement("article");card.className="artifact-card";
    const head=document.createElement("div");head.className="chart-header";
    const title=document.createElement("div");
    const h=document.createElement("h3");h.textContent=chart.datasetTitle+" / "+chart.metricTitle;
    const sub=document.createElement("small");sub.className="muted";sub.textContent=chart.points.length+" 个时间点 · "+chart.aggregation+" · "+chart.unit;
    title.append(h,sub);head.append(title);card.append(head);
    const plot=document.createElement("div");plot.className="chart-plot";
    const graph=svg("svg",{viewBox:"0 0 800 330",role:"img","aria-label":h.textContent+"趋势图"});
    const left=70,right=780,top=34,bottom=264,width=right-left,height=bottom-top;
    const values=points.map(p=>Number(p.value)).filter(Number.isFinite);
    if(values.length){
      let low=Math.min(...values), high=Math.max(...values);
      const pad=Math.max((high-low)*.13,Math.abs(high)*.045,.5);low-=pad;high+=pad;
      const X=i=>left+(points.length===1?width/2:i*width/(points.length-1));
      const Y=v=>bottom-(v-low)/(high-low)*height;
      for(let i=0;i<5;i++){
        const val=low+(high-low)*i/4,y=Y(val);
        graph.append(svg("line",{x1:left,x2:right,y1:y,y2:y,stroke:"#2d4260","stroke-dasharray":"4 6"}));
        graph.append(svg("text",{x:60,y:y+4,"text-anchor":"end",fill:"#8fa4be","font-size":13},+val.toFixed(1)));
      }
      graph.append(svg("line",{x1:left,x2:right,y1:bottom,y2:bottom,stroke:"#68809d"}));
      if(chart.chartType==="bar"){
        const bw=Math.min(35,width/points.length*.6);
        points.forEach((p,i)=>{const x=X(i),y=Y(Number(p.value));
          graph.append(svg("rect",{x:x-bw/2,y:y,width:bw,height:Math.max(1,bottom-y),rx:5,fill:"#75d8c7"}));
        });
      }else{
        const path=points.map((p,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(Number(p.value)).toFixed(1)).join(" ");
        graph.append(svg("path",{d:path,fill:"none",stroke:"#75d8c7","stroke-width":3.2,"stroke-linejoin":"round","stroke-linecap":"round"}));
        points.forEach((p,i)=>graph.append(svg("circle",{cx:X(i),cy:Y(Number(p.value)),r:4.4,fill:"#0c1729",stroke:"#75d8c7","stroke-width":2.4})));
      }
      const maxLabels=points.length>25?6:points.length>12?8:points.length;
      const every=Math.max(1,Math.ceil(points.length/maxLabels));
      points.forEach((p,i)=>{
        if(i%every!==0&&i!==points.length-1)return;
        graph.append(svg("text",{x:X(i),y:bottom+23,fill:"#91a6bf","font-size":points.length>30?11:13,"text-anchor":"middle"},p.period));
      });
      const last=points.at(-1);
      graph.append(svg("text",{x:right,y:19,fill:"#b9dcd7","text-anchor":"end","font-size":13},"最新值 "+last.value+" "+chart.unit));
    }
    plot.append(graph);card.append(plot);
    const summary=chart.summary||{};
    const grid=document.createElement("div");grid.className="stat-grid";
    [["起点",summary.first?.value],["终点",summary.last?.value],["最高",summary.highest?.value],["首尾变化",summary.change]].forEach(([label,value])=>{
      const box=document.createElement("div");box.className="stat";
      const b=document.createElement("b");b.textContent=value??"—";
      const span=document.createElement("span");span.textContent=label+" · "+chart.unit;box.append(b,span);grid.append(box);
    });card.append(grid);
    const source=document.createElement("div");source.className="source muted";
    const caption=document.createElement("div");caption.textContent="口径说明："+chart.caveat;
    const link=document.createElement("a");link.href=chart.source;link.target="_blank";link.rel="noopener noreferrer";link.textContent="查看原始数据来源 ↗";
    source.append(caption,link);card.append(source);
    return card;
  }
  function addChart(chart) {
    if(state.charts===0)el("artifacts").replaceChildren();
    el("artifacts").prepend(chartNode(chart));
    state.charts++;el("chartCount").textContent=state.charts+" 个图表";
  }
  const statusIcon={pending:"○",in_progress:"●",completed:"✓"};
  function renderPlan(plan) {
    const host=el("planHost");host.replaceChildren();
    const card=document.createElement("article");card.className="plan-card";
    const title=document.createElement("h3");title.textContent="调查计划";
    const goal=document.createElement("p");goal.className="plan-goal";goal.textContent=plan.requirement?.goal||"";
    card.append(title,goal);
    const req=plan.requirement||{};
    const meta=document.createElement("div");meta.className="plan-meta";
    [["数据集",req.dataset],["指标",req.metric],["范围",req.timeRange]].forEach(([k,v])=>{if(!v)return;const s=document.createElement("span");s.textContent=k+"："+v;meta.append(s);});
    if(meta.childNodes.length)card.append(meta);
    const caveats=req.caveats||[];
    if(caveats.length){const ul=document.createElement("ul");ul.className="plan-caveats";caveats.forEach(c=>{const li=document.createElement("li");li.textContent=c;ul.append(li);});card.append(ul);}
    const list=document.createElement("ol");list.className="plan-steps";
    (plan.steps||[]).forEach(step=>{const li=document.createElement("li");li.className="plan-step "+(step.status||"pending");
      const icon=document.createElement("span");icon.className="plan-status";icon.textContent=statusIcon[step.status]||"○";
      li.append(icon,document.createTextNode(" "+step.action));list.append(li);});
    card.append(list);host.append(card);
  }
  const currentSteps=new Map();
  function stepStart(event) {
    if(state.tools===0)el("timeline").replaceChildren();
    state.tools++;el("toolCount").textContent="("+state.tools+")";
    const div=document.createElement("div");div.className="step running";
    const title=document.createElement("strong");title.textContent="⏳ "+event.name;
    const args=document.createElement("pre");args.textContent=JSON.stringify(event.args||{});
    div.append(title,args);el("timeline").prepend(div);currentSteps.set(event.id,div);
  }
  function stepEnd(event) {
    const div=currentSteps.get(event.id);
    if(!div)return;
    div.className="step "+(event.isError?"fail":"ok");
    div.querySelector("strong").textContent=(event.isError?"✕ ":"✓ ")+event.name;
    const detail=div.querySelector("pre");
    detail.textContent=(detail.textContent||"")+"\n"+String(event.result||"").slice(0,350);
    currentSteps.delete(event.id);
  }
  async function loadStatus() {
    try {
      const r=await fetch("/api/status");const data=await r.json();
      el("mode").textContent=data.mode==="live"?"● 真实 Pi Agent · "+data.provider+"/"+data.model:"◌ 离线脚本演示（非 LLM）";
      el("mode").title=data.message;
    }catch{el("mode").textContent="无法连接后端";}
  }
  async function loadDatasets() {
    const r=await fetch("/api/datasets");const list=await r.json();
    const host=el("datasets");host.replaceChildren();
    for(const row of list){
      const btn=document.createElement("button");btn.className="data-btn";btn.type="button";
      const name=document.createElement("strong");name.textContent=row.title;
      const note=document.createElement("span");note.textContent=row.count+" 行 · "+(row.count===0?"尚未导入":"SQLite 就绪");
      btn.append(name,note);btn.addEventListener("click",()=>preview(row.id,btn));
      host.append(btn);
    }
  }
  async function preview(id,btn) {
    document.querySelectorAll(".data-btn").forEach(b=>b.classList.remove("selected"));btn.classList.add("selected");
    const host=el("preview");host.textContent="正在读取 SQLite…";
    try{
      const res=await fetch("/api/datasets/"+id+"/preview");const obj=await res.json();
      host.replaceChildren();
      if(!obj.preview?.length){host.textContent="暂无记录。请先运行 npm run import:weather。";return;}
      const table=document.createElement("table");
      const keys=Object.keys(obj.preview[0]);const thead=document.createElement("thead"),tr=document.createElement("tr");
      keys.forEach(key=>{const th=document.createElement("th");th.textContent=key;tr.append(th);});thead.append(tr);table.append(thead);
      const tbody=document.createElement("tbody");
      obj.preview.forEach(row=>{const tr=document.createElement("tr");keys.forEach(key=>{const td=document.createElement("td");td.textContent=row[key]??"—";tr.append(td);});tbody.append(tr);});table.append(tbody);host.append(table);
      const p=document.createElement("p");p.className="source muted";p.textContent=obj.caveat;host.append(p);
    }catch(e){host.textContent="读取失败："+e.message;}
  }
  async function sendMessage(text) {
    if(state.busy)return;
    const question=text.trim();if(!question)return;
    state.busy=true;el("sendBtn").disabled=true;el("messageInput").disabled=true;notify("");
    bubble("user",question);const response=bubble("assistant","");let raw="";
    try {
      const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:question,sessionId:state.sessionId})});
      if(!r.ok)throw new Error((await r.json()).error||"HTTP "+r.status);
      if(!r.body)throw new Error("当前浏览器不支持流式响应");
      const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="";
      while(true){
        const next=await reader.read();if(next.done)break;
        buffer+=decoder.decode(next.value,{stream:true});
        let idx;while((idx=buffer.indexOf("\n\n"))!==-1){
          const chunk=buffer.slice(0,idx);buffer=buffer.slice(idx+2);
          const line=chunk.split("\n").find(s=>s.startsWith("data: "));
          if(!line)continue;
          let event;try{event=JSON.parse(line.slice(6));}catch{continue;}
          if(event.type==="meta"){state.sessionId=event.sessionId;sessionStorage.setItem("nanjing-session",state.sessionId);}
          if(event.type==="delta"){raw+=event.text;renderMd(response,raw);el("messages").scrollTop=el("messages").scrollHeight;}
          if(event.type==="tool_start")stepStart(event);
          if(event.type==="tool_end")stepEnd(event);
          if(event.type==="chart")addChart(event.chart);
          if(event.type==="plan")renderPlan(event.plan);
          if(event.type==="error"){notify(event.message);raw+="\n\n[运行中断] "+event.message;renderMd(response,raw);}
        }
      }
      if(!raw.trim())renderMd(response,"任务已结束，但没有收到可显示的文本。");
    }catch(e){notify("请求失败："+e.message);raw+="\n\n请求失败："+e.message;renderMd(response,raw);}
    finally{state.busy=false;el("sendBtn").disabled=false;el("messageInput").disabled=false;el("messageInput").focus();}
  }
  el("chatForm").addEventListener("submit",e=>{e.preventDefault();const q=el("messageInput").value;el("messageInput").value="";sendMessage(q);});
  el("suggestions").addEventListener("click",e=>{const btn=e.target.closest("[data-q]");if(btn)sendMessage(btn.dataset.q);});
  el("reset").addEventListener("click",()=>{if(state.busy)return;state.sessionId=newId();sessionStorage.setItem("nanjing-session",state.sessionId);state.charts=0;state.tools=0;currentSteps.clear();
    el("messages").replaceChildren();bubble("assistant","新会话已开始。请选择一个南京数据主题。");el("timeline").textContent="工具调用尚未开始。";el("artifacts").replaceChildren();
    el("planHost").replaceChildren();
    const empty=document.createElement("p");empty.className="small muted";empty.textContent="尚无调查计划；提问后 Agent 会先提交计划。";el("planHost").append(empty);
    const placeholder=document.createElement("div");placeholder.className="empty-chart";placeholder.textContent="等待下一次数据调查";el("artifacts").append(placeholder);
    el("chartCount").textContent="0 个图表";el("toolCount").textContent="(0)";notify("");});
  loadStatus();loadDatasets();
})();