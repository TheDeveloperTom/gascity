//go:build !darwin

package workspacesvc

// platformOrphanTable reports that this platform sweeps through /proc (see
// findOrphanedServiceProcesses) rather than through a process table.
func platformOrphanTable() (orphanProcTable, bool) {
	return orphanProcTable{}, false
}
