import { ArrowLeft, Database, Table } from "@phosphor-icons/react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TableStructureTab } from "@/types/tabTypes";

export function TableStructureView({ tab }: { tab: TableStructureTab }) {
	return (
		<Card className="workspace-panel">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Table Structure: {tab.tableName}</CardTitle>
						<CardDescription>
							Column information, indexes, and foreign keys
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{tab.loading ? (
					<div className="space-y-6">
						<div>
							<div className="flex items-center gap-2 mb-3">
								<Skeleton className="h-5 w-5 rounded" />
								<Skeleton className="h-6 w-32 rounded" />
							</div>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									{[...Array(5)].map((_, i) => (
										<Skeleton key={i} className="h-8 flex-1 rounded" />
									))}
								</div>
								{[...Array(5)].map((_, rowIndex) => (
									<div key={rowIndex} className="flex items-center gap-2">
										{[...Array(5)].map((_, colIndex) => (
											<Skeleton key={colIndex} className="h-6 flex-1 rounded" />
										))}
									</div>
								))}
							</div>
						</div>
					</div>
				) : tab.structure ? (
					<>
						<div>
							<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
								<Database className="w-5 h-5" />
								Columns ({tab.structure.columns?.length || 0})
							</h3>
							<div className="overflow-x-auto">
								<table className="w-full border-collapse border border-border">
									<thead>
										<tr className="bg-muted/50">
											<th className="border border-border px-3 py-2 text-left font-medium">
												Name
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Type
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Nullable
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Default
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Primary Key
											</th>
										</tr>
									</thead>
									<tbody>
										{tab.structure.columns?.map((column, index) => (
											<tr key={index} className="hover:bg-muted/30">
												<td className="border border-border px-3 py-2 font-mono text-xs">
													{column.name}
												</td>
												<td className="border border-border px-3 py-2 text-xs">
													{column.type}
												</td>
												<td className="border border-border px-3 py-2 text-sm">
													{column.nullable ? (
														<span className="text-green-600">✓</span>
													) : (
														<span className="text-red-600">✗</span>
													)}
												</td>
												<td className="border border-border px-3 py-2 text-xs font-mono">
													{column.default || "-"}
												</td>
												<td className="border border-border px-3 py-2 text-sm">
													{column.primary_key ? (
														<span className="text-blue-600 font-semibold">
															✓
														</span>
													) : (
														<span className="text-gray-400">-</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						{tab.structure.indexes && tab.structure.indexes.length > 0 && (
							<div>
								<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
									<Table className="w-5 h-5" />
									Indexes ({tab.structure.indexes.length})
								</h3>
								<div className="overflow-x-auto">
									<table className="w-full border-collapse border border-border">
										<thead>
											<tr className="bg-muted/50">
												<th className="border border-border px-3 py-2 text-left font-medium">
													Name
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Columns
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Unique
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Primary
												</th>
											</tr>
										</thead>
										<tbody>
											{tab.structure.indexes.map((index, idx) => (
												<tr key={idx} className="hover:bg-muted/30">
													<td className="border border-border px-3 py-2 font-mono text-xs">
														{index.name}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{Array.isArray(index.columns)
															? index.columns.join(", ")
															: index.columns}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{index.unique ? (
															<span className="text-orange-600">✓</span>
														) : (
															<span className="text-gray-400">-</span>
														)}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{index.primary ? (
															<span className="text-blue-600 font-semibold">
																✓
															</span>
														) : (
															<span className="text-gray-400">-</span>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{tab.structure.foreign_keys &&
							tab.structure.foreign_keys.length > 0 && (
								<div>
									<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
										<ArrowLeft className="w-5 h-5" />
										Foreign Keys ({tab.structure.foreign_keys.length})
									</h3>
									<div className="overflow-x-auto">
										<table className="w-full border-collapse border border-border">
											<thead>
												<tr className="bg-muted/50">
													<th className="border border-border px-3 py-2 text-left font-medium">
														Name
													</th>
													<th className="border border-border px-3 py-2 text-left font-medium">
														Column
													</th>
													<th className="border border-border px-3 py-2 text-left font-medium">
														References
													</th>
												</tr>
											</thead>
											<tbody>
												{tab.structure.foreign_keys.map((fk, idx) => (
													<tr key={idx} className="hover:bg-muted/30">
														<td className="border border-border px-3 py-2 font-mono text-xs">
															{fk.name}
														</td>
														<td className="border border-border px-3 py-2 font-mono text-xs">
															{fk.column}
														</td>
														<td className="border border-border px-3 py-2 text-sm">
															{fk.references_table}.{fk.references_column}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
					</>
				) : (
					<p className="text-muted-foreground text-center py-8">
						Failed to load table structure.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
