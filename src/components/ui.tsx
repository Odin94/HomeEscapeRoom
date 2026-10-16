import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
const button = cva("button", {
  variants: {
    variant: { default: "primary", outline: "outline", ghost: "ghost" },
  },
  defaultVariants: { variant: "default" },
});
export function Button({
  className,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
}) {
  return (
    <button
      className={twMerge(clsx(button({ variant }), className))}
      {...props}
    />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {title} controls and details
          </Dialog.Description>
          <Dialog.Close className="close" aria-label="Close">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
