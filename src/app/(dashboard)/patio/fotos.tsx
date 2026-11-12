"use client";

/**
 * Aba Fotos da ficha do carro.
 * Arrastar e soltar para reordenar (mouse, toque e teclado), setas para
 * ajuste fino, "virar capa" e remover — tudo num rascunho local. Só vai
 * para o site quando clica em "Salvar ordem" (um salvamento, uma
 * atualização do site), em vez de salvar a cada clique.
 * A ficha monta este componente com key = atualizado_em: depois de salvar,
 * o rascunho recomeça a partir do que ficou no site.
 */
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { enviarParaCloudinary } from "@/lib/patio/cloudinary";
import { Foto, type CarroUI } from "./comum";

type FotoCarro = NonNullable<CarroUI["images"]>[number];
type Item = { id: string; foto: FotoCarro };
type Mapa = Record<string, unknown>;

const paraItens = (fotos: FotoCarro[]): Item[] => fotos.map((foto, i) => ({ id: `${i}|${foto.url}`, foto }));
const assinatura = (itens: Item[]) => itens.map((it) => it.foto.url).join("\n");

export function Fotos({ carro, podeEditar, salvando, salvar }: { carro: CarroUI; podeEditar: boolean; salvando: boolean; salvar: (m: Mapa, pronto?: string) => void }) {
  const salvas = useMemo(() => paraItens(carro.images ?? []), [carro.images]);
  const [itens, setItens] = useState<Item[]>(salvas);
  const [removidas, setRemovidas] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  const mudou = assinatura(itens) !== assinatura(salvas);

  // Avisa antes de sair da página com ordem não salva.
  useEffect(() => {
    if (!mudou) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [mudou]);

  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const travado = !podeEditar || salvando || !!enviando;
  const mover = (de: number, para: number) => {
    if (para < 0 || para >= itens.length || de === para) return;
    setItens(arrayMove(itens, de, para));
  };
  const remover = (i: number) => {
    setRemovidas([...removidas, itens[i]]);
    setItens(itens.filter((_, j) => j !== i));
  };
  const restaurar = (id: string) => {
    const it = removidas.find((r) => r.id === id);
    if (!it) return;
    setRemovidas(removidas.filter((r) => r.id !== id));
    setItens([...itens, it]);
  };
  const desfazer = () => { setItens(salvas); setRemovidas([]); };
  const salvarOrdem = () => {
    if (!itens.length && !confirm("Isso tira todas as fotos do anúncio. Continuar?")) return;
    salvar({ images: itens.map((it) => it.foto) }, "Fotos salvas. O site está sendo atualizado (leva uns minutos).");
  };

  function inicio(e: DragStartEvent) { setArrastando(String(e.active.id)); }
  function fim(e: DragEndEvent) {
    setArrastando(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const de = itens.findIndex((it) => it.id === active.id);
    const para = itens.findIndex((it) => it.id === over.id);
    if (de >= 0 && para >= 0) setItens(arrayMove(itens, de, para));
  }

  async function adicionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!arquivos.length) return;
    const novas: FotoCarro[] = [];
    try {
      for (const [i, arq] of arquivos.entries()) {
        setEnviando(`Enviando foto ${i + 1} de ${arquivos.length}…`);
        const url = await enviarParaCloudinary(arq, `media/veh_${carro.id}_${Date.now().toString(36)}${i}`);
        novas.push({ url, ts: Date.now() } as FotoCarro);
      }
    } catch (err) {
      setEnviando(`Uma foto não subiu (${(err as Error).message}). As que subiram serão salvas.`);
    }
    if (novas.length) {
      setEnviando(null);
      // Mantém a ordem que já estava sendo montada e coloca as novas no fim.
      salvar({ images: [...itens.map((it) => it.foto), ...novas] });
    }
  }

  const ativo = arrastando ? itens.find((it) => it.id === arrastando) : null;
  const ativoPos = ativo ? itens.indexOf(ativo) : -1;

  return (
    <section className="card fotos-ordem" style={{ padding: 20 }} aria-label="Fotos do carro">
      {itens.length > 0 && (
        <div className="fo-previa" aria-label="Prévia de como fica no site">
          <Foto url={itens[0]?.foto.url} alt="Capa" className="fo-previa-capa" />
          <div className="fo-previa-tira">
            {itens.slice(1, 5).map((it) => <Foto key={it.id} url={it.foto.url} alt="" />)}
          </div>
          <span className="rot">Prévia: capa + as 4 seguintes, como aparecem no site</span>
        </div>
      )}

      {itens.length === 0 ? (
        <p className="rot" style={{ fontSize: 14, margin: 0 }}>{removidas.length ? "Todas as fotos foram tiradas do rascunho." : "Este carro ainda não tem fotos."}</p>
      ) : (
        <>
          {podeEditar && <p className="rot" style={{ margin: "0 0 12px", fontSize: 13 }}>Arraste as fotos para mudar a ordem (no celular, segure e arraste). A <b>1ª é a capa</b>. Nada vai pro site até clicar em <b>Salvar ordem</b>.</p>}
          <DndContext sensors={sensores} collisionDetection={closestCenter} onDragStart={inicio} onDragEnd={fim} onDragCancel={() => setArrastando(null)}>
            <SortableContext items={itens.map((it) => it.id)} strategy={rectSortingStrategy}>
              <ul className="fo-grade">
                {itens.map((it, i) => (
                  <Cartao key={it.id} item={it} pos={i} total={itens.length} travado={travado} podeEditar={podeEditar}
                    mover={mover} remover={remover} />
                ))}
              </ul>
            </SortableContext>
            <DragOverlay>
              {ativo ? (
                <div className="fo-item fo-voando">
                  <Foto url={ativo.foto.url} alt="" className="fo-img" />
                  <span className={`fo-num ${ativoPos === 0 ? "fo-capa" : ""}`}>{ativoPos + 1}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {removidas.length > 0 && (
        <div className="fo-removidas">
          <span className="rot">Vão sair do anúncio ao salvar ({removidas.length}):</span>
          {removidas.map((r) => (
            <button key={r.id} type="button" className="fo-removida" onClick={() => restaurar(r.id)} title="Clique para devolver">
              <Foto url={r.foto.url} alt="" />
              <span>Devolver</span>
            </button>
          ))}
        </div>
      )}

      {podeEditar && (
        <div className={`fo-barra ${mudou ? "fo-barra-ativa" : ""}`}>
          <label className="btns" style={{ cursor: travado ? "default" : "pointer" }}>
            + Adicionar fotos
            <input type="file" accept="image/*" multiple onChange={adicionar} disabled={travado} className="sr-only" />
          </label>
          <span className="rot" style={{ fontSize: 13, flex: 1 }} role="status">
            {enviando ?? (mudou ? "Ordem alterada e ainda não salva." : "Fotos em 1200×900 (4:3) ficam melhor no site.")}
          </span>
          {mudou && <button type="button" className="btns" onClick={desfazer} disabled={salvando}>Desfazer</button>}
          <button type="button" className="btnp" onClick={salvarOrdem} disabled={!mudou || travado}>{salvando ? "Salvando…" : "Salvar ordem"}</button>
        </div>
      )}
    </section>
  );
}

function Cartao({ item, pos, total, travado, podeEditar, mover, remover }: {
  item: Item; pos: number; total: number; travado: boolean; podeEditar: boolean;
  mover: (de: number, para: number) => void; remover: (i: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: travado });
  const estilo: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 };
  return (
    <li ref={setNodeRef} style={estilo} className={`fo-item ${pos === 0 ? "fo-item-capa" : ""}`}>
      <div className="fo-pega" {...attributes} {...listeners} aria-label={`Foto ${pos + 1} de ${total}${pos === 0 ? " (capa)" : ""}. Arraste para mudar a posição.`}>
        <Foto url={item.foto.url} alt={`Foto ${pos + 1}`} className="fo-img" />
        <span className={`fo-num ${pos === 0 ? "fo-capa" : ""}`}>{pos === 0 ? "Capa" : pos + 1}</span>
      </div>
      {podeEditar && (
        <div className="fo-acoes">
          <button type="button" className="fo-bt" disabled={travado || pos === 0} onClick={() => mover(pos, pos - 1)} aria-label="Uma posição para trás" title="Para trás">←</button>
          <button type="button" className="fo-bt" disabled={travado || pos === total - 1} onClick={() => mover(pos, pos + 1)} aria-label="Uma posição para frente" title="Para frente">→</button>
          <button type="button" className="fo-bt fo-bt-txt" disabled={travado || pos === 0} onClick={() => mover(pos, 0)} title="Virar capa">Capa</button>
          <button type="button" className="fo-bt fo-bt-txt" disabled={travado || pos === total - 1} onClick={() => mover(pos, total - 1)} title="Mandar para o fim">Fim</button>
          <button type="button" className="fo-bt fo-bt-del" disabled={travado} onClick={() => remover(pos)} aria-label={`Remover foto ${pos + 1}`} title="Remover">✕</button>
        </div>
      )}
    </li>
  );
}
