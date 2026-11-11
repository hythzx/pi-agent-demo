(() => {
  const slides=[...document.querySelectorAll(".slide")];
  let index=0;
  const el=id=>document.getElementById(id);
  el("total").textContent=String(slides.length).padStart(2,"0");
  function show(next){
    index=Math.max(0,Math.min(slides.length-1,next));
    slides.forEach((s,i)=>s.classList.toggle("active",i===index));
    el("page").textContent=String(index+1).padStart(2,"0");
    el("section").textContent=slides[index].querySelector("h1,h2")?.textContent.replace(/\s+/g," ").slice(0,25)||"";
    el("progress").style.width=((index+1)/slides.length*100)+"%";
    el("prev").disabled=index===0;el("next").disabled=index===slides.length-1;
    el("notes").textContent=slides[index].dataset.note||"";
    if(location.hash!=="#"+(index+1))history.replaceState(null,"","#"+(index+1));
  }
  function toggleNotes(){el("notes").hidden=!el("notes").hidden;el("notesBtn").setAttribute("aria-pressed",String(!el("notes").hidden));}
  el("next").addEventListener("click",()=>show(index+1));
  el("prev").addEventListener("click",()=>show(index-1));
  el("notesBtn").addEventListener("click",toggleNotes);
  el("fullBtn").addEventListener("click",()=>{
    if(document.fullscreenElement)document.exitFullscreen?.();
    else el("stage").requestFullscreen?.();
  });
  document.addEventListener("keydown",e=>{
    if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName))return;
    if(e.key==="ArrowRight"||e.key==="PageDown"||e.key===" "){e.preventDefault();show(index+1);}
    if(e.key==="ArrowLeft"||e.key==="PageUp"){e.preventDefault();show(index-1);}
    if(e.key==="Home")show(0);
    if(e.key==="End")show(slides.length-1);
    if(e.key.toLowerCase()==="n")toggleNotes();
    if(e.key.toLowerCase()==="f"&& !e.ctrlKey&&!e.metaKey)el("fullBtn").click();
  });
  const initial=Number(location.hash.slice(1));
  show(Number.isInteger(initial)&&initial>=1&&initial<=slides.length?initial-1:0);
  window.addEventListener("hashchange",()=>{const n=Number(location.hash.slice(1));if(n>=1&&n<=slides.length)show(n-1);});
})();