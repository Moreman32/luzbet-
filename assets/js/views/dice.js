import { rpc } from "../api.js"; import { h, fmt, toast, actionButton } from "../ui.js"; import { meme, sessionMeme } from "../memes.js"; import { sfx } from "../sound.js";
export async function mount(root,{app}){
 let chance=50,dir="under"; const bet=h("input",{class:"input",type:"number",min:1,max:7500,value:100});
 const pct=h("input",{class:"dice-range",type:"range",min:2,max:95,value:50}); const chanceEl=h("strong",{class:"dice-chance"},"50%");
 const mult=h("strong",{class:"gold num"},"1.94×"); const result=h("div",{class:"dice-result idle"},h("span",{},"—"),h("small",{},"ожидаем решение статистического комитета"));
 function sync(){chance=Number(pct.value);chanceEl.textContent=chance+"%";mult.textContent=(97/chance).toFixed(2)+"×";}
 pct.oninput=sync;
 const under=h("button",{class:"btn primary"},"НИЖЕ"); const over=h("button",{class:"btn"},"ВЫШЕ");
 function setDir(v){dir=v;under.className="btn "+(v==="under"?"primary":"");over.className="btn "+(v==="over"?"primary":"");}
 under.onclick=()=>setDir("under");over.onclick=()=>setDir("over");
 const play=actionButton("ПЕРЕДАТЬ ДЕЛО В ОТДЕЛ ВЕРОЯТНОСТЕЙ",async()=>{
  const amount=Math.floor(Number(bet.value)); if(!amount||amount<1)return toast("Ставка должна существовать хотя бы юридически.","error");
  const r=await rpc("rpc_dice_roll",{p_bet:amount,p_chance:chance,p_direction:dir,p_idempotency_key:crypto.randomUUID()});
  const x=r.round.state.roll/100,won=r.round.state.won; result.className="dice-result "+(won?"won":"lost");
  result.replaceChildren(h("span",{},x.toFixed(2)),h("small",{},won?"ПОСТАНОВЛЕНИЕ: ВЫПЛАТИТЬ":"ПОСТАНОВЛЕНИЕ: ОТКАЗАТЬ"));
  app.setBalance(r.round.balance??app.me.balance); await app.refreshMe(); won?sfx.cash():sfx.error(); const mctx=won&&chance<=15?"dice.longshotWin":!won&&chance>=80?"dice.safeLoss":won?"dice.win":"dice.loss"; toast(sessionMeme({won,lost:!won,balance:r.round.balance??app.me.balance})||meme(mctx),won?"ok":"error");
 },{class:"btn primary lg block"});
 root.append(h("div",{class:"container stack dice-page"},h("div",{class:"dice-title"},h("div",{},h("div",{class:"eyebrow"},"Комитет по случайным числам"),h("h1",{},"Dice"),h("p",{class:"muted"},"Вы задаёте вероятность. Мы предоставляем число. Ответственность за выводы остаётся на заявителе.")),h("div",{class:"badge gold"},"97% RTP")),
 h("section",{class:"dice-layout"},h("div",{class:"card gilded dice-stage"},h("div",{class:"dice-orb"},result),h("div",{class:"dice-scale"},h("span",{},"0"),h("span",{},"50"),h("span",{},"100"))),
 h("div",{class:"card stack"},h("div",{class:"field"},h("label",{},"Ставка, ЛК"),bet),h("div",{class:"dice-metrics"},h("div",{},h("small",{class:"muted"},"Шанс"),chanceEl),h("div",{},h("small",{class:"muted"},"Выплата"),mult)),pct,h("div",{class:"row"},under,over),play,h("p",{class:"muted dice-legal"},"House edge 3%. Результат берётся из того же проверяемого HMAC-потока, что и другие игры. Отдел магии расформирован."))),
 h("div",{class:"card tight dice-memo"},h("b",{},"Служебная пометка:")," вероятность выигрыша регулируется ползунком. Вероятность сделать после выигрыша неправильные выводы — нет.")));
}