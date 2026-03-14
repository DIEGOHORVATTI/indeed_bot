import { useState } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import WorkIcon from '@mui/icons-material/WorkOutlineRounded'
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined'
import MenuOpenIcon from '@mui/icons-material/MenuOpenRounded'
import MenuIcon from '@mui/icons-material/MenuRounded'
import { alpha } from '@mui/material/styles'

import JobsPage from './pages/jobs'
import JobDetailPage from './pages/job-detail'
import CvsPage from './pages/cvs'

const DRAWER_FULL = 260
const DRAWER_MINI = 72

const navItems = [
  { to: '/jobs', label: 'Vagas', icon: <WorkIcon /> },
  { to: '/cvs', label: 'Curriculos', icon: <DescriptionIcon /> },
]

export function App() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const w = collapsed ? DRAWER_MINI : DRAWER_FULL

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: w,
          flexShrink: 0,
          transition: (t) => t.transitions.create('width', { duration: 200 }),
          '& .MuiDrawer-paper': {
            width: w,
            bgcolor: 'background.paper',
            borderRight: (t) => `1px dashed ${alpha(t.palette.grey[500], 0.12)}`,
            overflowX: 'hidden',
            transition: (t) => t.transitions.create('width', { duration: 200 }),
            px: collapsed ? 1 : 2,
            py: 3,
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', px: collapsed ? 0 : 1, mb: 4 }}>
          {!collapsed && (
            <Typography variant="h5" fontWeight={700} color="primary.main" noWrap>
              JobPilot
            </Typography>
          )}
          <IconButton onClick={() => setCollapsed((c) => !c)} size="small" sx={{ color: 'text.secondary' }}>
            {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
          </IconButton>
        </Box>

        <List disablePadding>
          {navItems.map(({ to, label, icon }) => {
            const isActive = location.pathname.startsWith(to)
            return (
              <Tooltip key={to} title={collapsed ? label : ''} placement="right" arrow>
                <ListItemButton
                  component={NavLink}
                  to={to}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.5,
                    minHeight: 44,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    px: collapsed ? 1.5 : 2,
                    color: isActive ? 'primary.main' : 'text.secondary',
                    bgcolor: isActive ? (t) => alpha(t.palette.primary.main, 0.08) : 'transparent',
                    '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
                  }}
                >
                  <ListItemIcon sx={{ color: 'inherit', minWidth: collapsed ? 0 : 36, mr: collapsed ? 0 : 1.5 }}>
                    {icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText primary={label} primaryTypographyProps={{ fontSize: 14, fontWeight: isActive ? 600 : 400 }} />
                  )}
                </ListItemButton>
              </Tooltip>
            )
          })}
        </List>

        <Box sx={{ mt: 'auto', pt: 2, textAlign: 'center' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
            {collapsed ? 'v1' : 'v1.0.0'}
          </Typography>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'auto', p: 3 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/cvs" element={<CvsPage />} />
        </Routes>
      </Box>
    </Box>
  )
}
