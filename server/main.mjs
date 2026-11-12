import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { listDatasets, describeDataset, saveMessage, getHistory } from "./db.mjs";
import { createDataAgent } from "./agent.mjs";
import { runOffline } from "./offline.mjs";

const sessions = new Map();
const webDir = resolve("web");
const allowed = {
  "/slides": "slides.html", "/slides.html": "slides.html",
  "/agent": "agent.html", "/agent.html": "agent.html",
  "/web/shared.css": "shared.css",
  "/web/slides.js": "slides.js",
  "/web/agent.js": "agent.js",
  "/web/vendor/marked.umd.js": "vendor/marked.umd.js",
  "/web/vendor/purify.min.js": "vendor/purify.min.js"
};
const mime = { html:"text/html; charset=utf-8", css:"text/css; charset=utf-8", js:"text/javascript; charset=utf-8" };
function json(res, data, status=200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function send(res, event) {
  if (!res.destroyed && !res.writableEnded) res.write("data: " + JSON.stringify(event) + "\n\n");
}
async function bodyJson(req) {
  let size=0, text="";
  for await (const part of req) {
    size+=part.length;
    if (size>12000) throw new Error("请求体过大");
    text+=part.toString("utf8");
  }
  return JSON.parse(text);
}
async function handleChat(req,res) {
  const input=await bodyJson(req);
  const question=typeof input.message==="string" ? input.message.trim() : "";
  const sessionId=typeof input.sessionId==="string" && /^[a-zA-Z0-9-]{8,64}$/.test(input.sessionId) ? input.sessionId : randomUUID();
  if (!question || question.length>2000) return json(res,{error:"问题必须为1—2000字"},400);
  const previous=sessions.get(sessionId);
  if (previous?.busy) return json(res,{error:"当前会话仍在运行，请等待它结束"},409);
  if (sessions.size>60) {
    const old=sessions.keys().next().value;
    if (old && !sessions.get(old)?.busy) sessions.delete(old);
  }
  const state=previous || { agent:null, planning:null, busy:false };
  sessions.set(sessionId,state);
  state.busy=true;
  res.writeHead(200, {
    "content-type":"text/event-stream; charset=utf-8",
    "cache-control":"no-cache, no-transform",
    "connection":"keep-alive",
    "x-content-type-options":"nosniff"
  });
  const emit = event => send(res,event);
  let text="", unsubscribe;
  emit({type:"meta",sessionId,mode:config.live?"live":"offline"});
  saveMessage(sessionId,"user",question);
  const onClose=()=>{ if (!res.writableEnded && state.agent) state.agent.abort(); };
  res.on("close",onClose);
  try {
    if (!config.live) {
      text=await runOffline(question,emit);
    } else {
      if (!state.agent) {
        const created=createDataAgent(sessionId);
        state.agent=created.agent; state.planning=created.planning;
      }
      // 每个新问题重新规划：复位后钩子会再次强制 submit_plan。
      state.planning.submitted=false; state.planning.plan=null;
      unsubscribe=state.agent.subscribe(event=>{
        if (event.type==="message_update" && event.assistantMessageEvent?.type==="text_delta") {
          const chunk=event.assistantMessageEvent.delta;
          text+=chunk; emit({type:"delta",text:chunk});
        } else if (event.type==="tool_execution_start") {
          emit({type:"tool_start",id:event.toolCallId,name:event.toolName,args:event.args});
        } else if (event.type==="tool_execution_end") {
          emit({type:"tool_end",id:event.toolCallId,name:event.toolName,isError:Boolean(event.isError),
            result:JSON.stringify(event.result?.content ?? []).slice(0,1200)});
          if (event.result?.details?.chart) emit({type:"chart",chart:event.result.details.chart});
          if (event.result?.details?.plan) emit({type:"plan",plan:event.result.details.plan});
        } else if (event.type==="turn_start") emit({type:"turn_start"});
      });
      await state.agent.prompt(question);
      const err=state.agent.state.errorMessage;
      if (err) throw new Error(err);
      if (!text.trim()) {
        const messages=state.agent.state.messages.filter(m=>m.role==="assistant");
        const last=messages.at(-1);
        const parts=last?.content?.filter(x=>x.type==="text").map(x=>x.text).join("") || "";
        if (parts) { text=parts; emit({type:"delta",text:parts}); }
      }
    }
    if (text) saveMessage(sessionId,"assistant",text);
    emit({type:"done",sessionId});
  } catch (error) {
    console.error("Agent error:",error);
    emit({type:"error",message:String(error?.message || error)});
  } finally {
    unsubscribe?.();
    res.off("close",onClose);
    state.busy=false;
    res.end();
  }
}
const server=createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,"http://localhost");
    if (req.method==="GET" && url.pathname==="/") {
      res.writeHead(302,{location:"/slides"}); res.end(); return;
    }
    if (req.method==="GET" && url.pathname==="/api/status") {
      return json(res,{city:"南京",mode:config.live?"live":"offline",provider:config.provider,model:config.live?config.model:null,
        message:config.live?"Pi Agent Core 已连接":"离线脚本演示；未配置 LLM API Key"});
    }
    if (req.method==="GET" && url.pathname==="/api/datasets") return json(res,listDatasets());
    if (req.method==="GET" && /^\/api\/datasets\/[a-z_]+\/preview$/.test(url.pathname)) {
      const id=url.pathname.split("/")[3];
      return json(res,describeDataset(id));
    }
    if (req.method==="GET" && url.pathname==="/api/history") {
      const sessionId=url.searchParams.get("sessionId") || "";
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId)) return json(res,[],200);
      return json(res,getHistory(sessionId));
    }
    if (req.method==="POST" && url.pathname==="/api/chat") return await handleChat(req,res);
    if (req.method==="GET" && Object.hasOwn(allowed,url.pathname)) {
      const filename=allowed[url.pathname];
      const content=await readFile(join(webDir,filename));
      res.writeHead(200,{ "content-type":mime[filename.split(".").at(-1)] || "text/plain",
        "cache-control":"no-cache","x-content-type-options":"nosniff" });
      res.end(content);return;
    }
    json(res,{error:"Not found"},404);
  } catch(e) {
    console.error(e);
    if (!res.headersSent) json(res,{error:String(e.message||e)},500);
    else res.end();
  }
});
server.listen(config.port,"0.0.0.0",()=>{
  console.log("Nanjing Data Lab: http://localhost:"+config.port+"/slides");
  console.log("Interactive Agent: http://localhost:"+config.port+"/agent");
  console.log("Mode: "+(config.live?"LIVE Pi Agent Core":"OFFLINE scripted fallback"));
});
