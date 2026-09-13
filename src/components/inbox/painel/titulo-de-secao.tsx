import { cn } from '@/lib/utils';

/**
 * Título de seção — a MESMA tipografia nas duas fichas (contato e grupo).
 *
 * Em módulo próprio (e não dentro de `painel-do-contato.tsx`) porque a
 * aba Cobranças também é montada na ficha de `/contacts`: importá-lo do
 * painel arrastava o painel inteiro — negócio, campos, arquivos,
 * automações — para a rota de Contatos (revisão do PR #203). O painel o
 * reexporta para os chamadores antigos.
 */
export function TituloDeSecao({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase',
        className
      )}
    >
      {icon}
      {children}
    </div>
  );
}
