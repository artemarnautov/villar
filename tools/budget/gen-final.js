// Builds every number table for research/budget-tiers.md from budget-ladder-out*.json (no hand-typed numbers).
const fs=require('fs'); const D='/home/claude/villar/site/data/';
const o=require('./budget-ladder-out.json'), c=require('./budget-ladder-out-contract.json'), a=require('./ladder-out.json');
const L=require(D+'layout-studio.json'); const cat=require(D+'catalog.json'); const items=new Map(cat.items.map(i=>[i.id,i]));
const S=Object.keys(o); const f=n=>n==null?'—':n.toLocaleString('en-US').replace(/,/g,' ');
const keyOf=(p,s)=>(p.slots[s.id]&&s.id)||(s.group&&p.slots[s.group]&&s.group)||s.type;
const P=Object.fromEntries(S.map(s=>[s,require(D+'stylepack-'+s+'.json')]));
const filled=(s,sel)=>L.slots.filter(sl=>sel[keyOf(P[s],sl)]).length;
const F={};
// levels
let t='| Milestone | slots | '+S.join(' | ')+' |\n|---|---:|'+S.map(()=>'---:').join('|')+'|\n';
const rows=[['Minimum: tier 0 (slider left end, not a level)','tier:0'],['**Самое нужное / Essentials**: end of tier 1','endOfTier:1'],['**Удобно жить / Comfortable**: end of tier 2','endOfTier:2'],['**Под ключ / Move-in ready**: end of tier 3','endOfTier:3'],['end of tier 4 (all 33 slots, no level)','endOfTier:4'],['**Как в журнале / Magazine-ready**: designer room','designer'],['**Без компромиссов / No compromises**: premium end','premium']];
for (const [lab,k] of rows){ const st=o[S[0]].steps.find(x=>x.total===o[S[0]].milestones[k]); t+=`| ${lab} | ${filled(S[0],st.selection)} | `+S.map(s=>f(o[s].milestones[k])).join(' | ')+' |\n'; }
t+='| *ref: curated room as shipped today* | 33 | '+S.map(s=>f(o[s].curatedTotal)).join(' | ')+' |\n';
t+='| *ref: every slot at its cheapest option* | 33 | '+S.map(s=>f(a[s].lv.allCheap)).join(' | ')+' |\n';
t+='| *ref: every slot at its priciest option (ignores pairings)* | 33 | '+S.map(s=>f(a[s].lv.allMax)).join(' | ')+' |\n';
F.levels=t;
// level ranges
t='| Level | '+S.join(' | ')+' | across styles |\n|---|'+S.map(()=>'---').join('|')+'|---|\n';
const ms=['endOfTier:1','endOfTier:2','endOfTier:3','designer','premium']; const names=['Самое нужное / Essentials','Удобно жить / Comfortable','Под ключ / Move-in ready','Как в журнале / Magazine-ready','Без компромиссов / No compromises'];
ms.forEach((m,i)=>{ const lo=S.map(s=>o[s].milestones[m]); const hi=S.map(s=>i<ms.length-1?o[s].milestones[ms[i+1]]-1:o[s].milestones.premium);
  const k=v=>(Math.round(v/100)/10).toFixed(1)+'k';
  t+=`| ${names[i]} | `+S.map((s,j)=>lo[j]>hi[j]||(i<ms.length-1&&o[s].milestones[ms[i+1]]===lo[j])?`${f(lo[j])} (point)`:`${f(lo[j])}–${f(hi[j])}`).join(' | ')+` | from ${k(Math.min(...lo))}–${k(Math.max(...lo))} |\n`; });
F.ranges=t;
// add steps
const adds=s=>o[s].steps.filter(x=>x.kind!=='upg'&&x.kind!=='prem');
t='| # | Step | Tier | '+S.join(' | ')+' |\n|---|---|---|'+S.map(()=>'---:').join('|')+'|\n';
adds(S[0]).forEach((x,i)=>{ t+=`| ${i} | ${x.label.replace('+ dining_table + dining_chair','+ dining_table + 2 dining_chair')} | ${x.tier} | `+S.map(s=>{const y=adds(s)[i]; return `${f(y.total)} (${i?'+':''}${f(y.add)})`}).join(' | ')+' |\n'; });
F.adds=t;
// upgrades
t='';
for (const s of S){ const u=o[s].steps.filter(x=>x.kind==='upg'), p=o[s].steps.filter(x=>x.kind==='prem');
  t+=`- **${s}**: to the designer room (${u.length}): `+(u.map(x=>`${x.delta.map(d=>d.key).join(' + ')} +${f(x.add)}`).join(' · ')||'—')+` → **${f(o[s].milestones.designer)}**. Premium (${p.length}): `+p.map(x=>`${x.delta.map(d=>d.key).join(' + ')} +${f(x.add)}`).join(' · ')+` → **${f(o[s].milestones.premium)}**.\n`; }
F.upg=t;
// big steps + stats
t='';
for (const s of S){ const st=o[s].steps.slice(1); const ad=st.map(x=>x.add).sort((x,y)=>x-y); t+=`- ${s}: ${o[s].steps.length} steps, median ${f(ad[Math.floor(ad.length/2)])}; steps ≥ 2 000: `+st.filter(x=>x.add>=2000).map(x=>`${x.label.replace(/^[+↑] /,'')} +${f(x.add)}`).join('; ')+'\n'; }
F.big=t;
// round budgets
const B=[8000,10000,12000,15000,18000,20000,22000,25000,30000,35000,40000];
t='| Budget, AED | '+S.join(' | ')+' |\n|---:|'+S.map(()=>'---').join('|')+'|\n';
for (const b of B){ t+=`| ${f(b)} | `+S.map(s=>{const st=o[s].steps; let i=-1; st.forEach((x,j)=>{if(x.total<=b)i=j;}); if(i<0) return `below the minimum (${f(st[0].total)})`;
  const x=st[i]; const lv=[...o[s].levels].reverse().find(l=>x.total>=l.total); const nx=st[i+1];
  return `${f(x.total)} · ${filled(s,x.selection)}/33 · ${lv?lv.nameEn:'minimum'}${nx?` · next ${nx.label.replace(/^[+↑] /,'').replace(' → curated',' ↑').replace(' → premium',' ↑↑').replace(' + dining_chair','+chairs')} +${f(nx.add)}`:' · top'}`;}).join(' | ')+' |\n'; }
F.round=t;
// contract variant
t='| Milestone | '+S.join(' | ')+' |\n|---|'+S.map(()=>'---:').join('|')+'|\n';
for (const [lab,k] of [['end of tier 1','endOfTier:1'],['end of tier 2','endOfTier:2'],['end of tier 3','endOfTier:3'],['end of tier 4','endOfTier:4'],['designer room','designer']]) t+=`| ${lab} | `+S.map(s=>`${f(c[s].milestones[k])} (${c[s].milestones[k]-o[s].milestones[k]>=0?'+':''}${f(c[s].milestones[k]-o[s].milestones[k])})`).join(' | ')+' |\n';
t+='| furniture-pairing breaks along the ladder | '+S.map(s=>String(c[s].problems.length)).join(' | ')+' |\n';
F.contract=t;
// cheapest T0+T1 items, max T0+T1
t=''; for (const s of S){ const sel=o[s].steps.find(x=>x.total===o[s].milestones['endOfTier:1']).selection; const q={}; for(const sl of L.slots){const k=keyOf(P[s],sl); q[k]=(q[k]||0)+1;}
  t+=`- **${s}** (${f(o[s].milestones['endOfTier:1'])}): `+Object.entries(sel).map(([k,id])=>`${k}${q[k]>1?' ×'+q[k]:''} ${id} ${f(items.get(id).price*q[k])}`).join('; ')+'\n'; }
F.ess=t;
t='| | '+S.join(' | ')+' |\n|---|'+S.map(()=>'---:').join('|')+'|\n';
t+='| Essentials (10 keys / 12 slots) at the cheapest options, no pairings | '+S.map(s=>f(a[s].lv.L1)).join(' | ')+' |\n';
t+='| Essentials as the ladder builds it (furniture pairings kept) | '+S.map(s=>f(o[s].milestones['endOfTier:1'])).join(' | ')+' |\n';
t+='| the same 12 slots at their priciest options | '+S.map(s=>f(a[s].lv.T01max)).join(' | ')+' |\n';
t+='| complete 33-slot room (end of tier 4) | '+S.map(s=>f(o[s].milestones['endOfTier:4'])).join(' | ')+' |\n';
F.cmp=t;
fs.writeFileSync('frags.json',JSON.stringify(F)); for (const [k,v] of Object.entries(F)) console.log('#### '+k+'\n'+v);
