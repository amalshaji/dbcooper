import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ConnectionForm } from "@/components/ConnectionForm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, Gear, GithubLogo, PencilSimple, Trash } from "@phosphor-icons/react";

import { api, Connection, ConnectionFormData } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { UpdateChecker } from "@/components/UpdateChecker";

export function Connections() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [deletingConnection, setDeletingConnection] = useState<Connection | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchConnections = async () => {
    try {
      const data = await api.connections.list();
      setConnections(data);
    } catch (error) {
      console.error("Failed to fetch connections:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleCreateConnection = async (data: ConnectionFormData) => {
    try {
      await api.connections.create(data);
      await fetchConnections();
      setIsFormOpen(false);
    } catch (error) {
      console.error("Failed to create connection:", error);
    }
  };

  const handleUpdateConnection = async (data: ConnectionFormData) => {
    if (!editingConnection) return;
    try {
      await api.connections.update(editingConnection.id, data);
      await fetchConnections();
      setEditingConnection(null);
      setIsFormOpen(false);
    } catch (error) {
      console.error("Failed to update connection:", error);
    }
  };

  const handleEditConnection = (connection: Connection) => {
    setEditingConnection(connection);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setEditingConnection(null);
    setIsFormOpen(false);
  };

  const handleDeleteClick = (connection: Connection) => {
    setDeletingConnection(connection);
  };

  const handleConfirmDelete = async () => {
    if (!deletingConnection) return;

    setIsDeleting(true);
    try {
      await api.connections.delete(deletingConnection.id);
      await fetchConnections();
      setDeletingConnection(null);
    } catch (error) {
      console.error("Failed to delete connection:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setDeletingConnection(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-end gap-2 mb-4">
          <UpdateChecker />
          <a
            href="https://github.com/amalshaji/dbcooper"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors"
            title="View on GitHub"
          >
            <GithubLogo className="w-5 h-5" />
          </a>

          <button
            onClick={() => navigate("/settings")}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors"
            title="Settings"
          >
            <Gear className="w-5 h-5" />
          </button>
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Database Connections</CardTitle>
                <CardDescription>
                  Manage your database connections
                </CardDescription>
              </div>
              <Button onClick={() => setIsFormOpen(true)}>
                New Connection
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <EmptyState
                icon={
                  <Database className="w-16 h-16" />
                }
                title="No connections yet"
                description="Get started by creating your first database connection. You can connect to any Postgres database."
                action={{
                  label: "Create Connection",
                  onClick: () => setIsFormOpen(true),
                }}
              />
            ) : (
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Host
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Database
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        SSL
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {connections.map((connection) => (
                      <tr
                        key={connection.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/connections/${connection.uuid}`)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium">
                            {connection.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant="secondary" className="capitalize">
                            {connection.type || "postgres"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-muted-foreground">
                            {connection.host}:{connection.port}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-muted-foreground">
                            {connection.database}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant={connection.ssl ? "default" : "secondary"}>
                            {connection.ssl ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditConnection(connection);
                            }}
                            title="Edit connection"
                          >
                            <PencilSimple className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(connection);
                            }}
                            title="Delete connection"
                          >
                            <Trash className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConnectionForm
        isOpen={isFormOpen}
        onSubmit={editingConnection ? handleUpdateConnection : handleCreateConnection}
        onCancel={handleCloseForm}
        initialData={editingConnection}
      />

      <AlertDialog open={!!deletingConnection} onOpenChange={(open) => !open && handleCancelDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingConnection?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleCancelDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting && <Spinner className="mr-2" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
