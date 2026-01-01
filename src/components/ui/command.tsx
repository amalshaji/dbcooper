"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

function Command({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				"bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-lg",
				className,
			)}
			{...props}
		/>
	);
}
Command.displayName = "Command";

function CommandDialog({
	title = "Command Palette",
	description = "Search for a command to run",
	children,
	className,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof Dialog> & {
	title?: string;
	description?: string;
	className?: string;
	showCloseButton?: boolean;
}) {
	return (
		<>
			<style>{`
				[data-slot="dialog-overlay"] {
					transition-duration: 0ms !important;
					animation-duration: 0ms !important;
					animation: none !important;
					opacity: 1 !important;
				}
				[data-slot="dialog-overlay"][data-state="closed"] {
					opacity: 0 !important;
				}
			`}</style>
			<Dialog {...props}>
				<DialogHeader className="sr-only">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogContent
					className={cn(
						"overflow-hidden p-0 rounded-lg !duration-0 data-open:!animate-none data-closed:!animate-none data-open:!fade-in-0 data-closed:!fade-out-0 data-open:!zoom-in-100 data-closed:!zoom-out-100 data-open:!slide-in-from-0 data-closed:!slide-out-to-0",
						className,
					)}
					showCloseButton={showCloseButton}
				>
					<Command className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
						{children as React.ReactNode}
					</Command>
				</DialogContent>
			</Dialog>
		</>
	);
}
CommandDialog.displayName = "CommandDialog";

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div
			data-slot="command-input-wrapper"
			className="flex h-9 items-center gap-2 border-b px-3"
		>
			<MagnifyingGlass className="size-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					"placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-xs outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		</div>
	);
}
CommandInput.displayName = "CommandInput";

function CommandList({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn(
				"max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
				className,
			)}
			{...props}
		/>
	);
}
CommandList.displayName = "CommandList";

function CommandEmpty({
	...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className="py-6 text-center text-xs"
			{...props}
		/>
	);
}
CommandEmpty.displayName = "CommandEmpty";

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium",
				className,
			)}
			{...props}
		/>
	);
}
CommandGroup.displayName = "CommandGroup";

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("bg-border -mx-1 h-px", className)}
			{...props}
		/>
	);
}
CommandSeparator.displayName = "CommandSeparator";

function CommandItem({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[selected=true]:[&_svg]:!text-accent-foreground data-[selected=true]:[&_span]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}
CommandItem.displayName = "CommandItem";

function CommandShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="command-shortcut"
			className={cn(
				"text-muted-foreground ml-auto text-[10px] tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}
CommandShortcut.displayName = "CommandShortcut";

export {
	Command,
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandShortcut,
	CommandSeparator,
};
