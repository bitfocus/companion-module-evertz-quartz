## Evertz Quartz Router Module

A module for controlling Evertz routers with the Quartz protocol (including EQX and EQT series routers).

### Setup

Enter the IP address and TCP port in the module config. The default port is 23, but other ports may be configured on your device—check your device manual and configuration settings.

Source and destination numbers are defined within the Quartz interface, so they may differ from EQX crosspoint numbers.

### Levels

The legal levels are V,A,B,C,D,E,F,G in 8 level systems and V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O in 16 level systems. MAGNUM based control systems support up to 26 legal levels: V,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,W,X,Y,Z.

Multiple levels can be set at once. For example, `VABC` routes video and the first 3 audio levels together.

### Actions

| Action                                   | Description                                             |
| ---------------------------------------- | ------------------------------------------------------- |
| **Fire Salvo**                           | Fire a salvo by ID                                      |
| **Lock/Unlock Destination**              | Lock, unlock, or toggle a destination                   |
| **Route Source to Destination**          | Route using dropdown selection                          |
| **Route Source to Destination (by ID)**  | Route using numeric IDs with variable support           |
| **Set Destination**                      | Select a destination for subsequent routing             |
| **Route Source to Selected Destination** | Route a source to the previously selected destination   |
| **Select Destination for Take**          | Select destination for the Take workflow                |
| **Select Source for Take**               | Select source for the Take workflow                     |
| **Take**                                 | Execute the route using selected source and destination |

**Traditional router panel workflow:** Use "Set Destination" or "Select Destination for Take", then "Route Source to Selected Destination" or "Select Source for Take" + "Take" to build a panel where you press destination first, then source.

**Variable-driven routing:** Use "Route Source to Destination (by ID)" with Companion variables for scripted or dynamic routing.

### Variables

The module exposes variables for use in button text and triggers:

| Variable                      | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `destination`                 | Currently selected destination ID                        |
| `destination_name`            | Currently selected destination name                      |
| `dst`                         | Selected destination for Take workflow                   |
| `src`                         | Selected source for Take workflow                        |
| `src_1_name`, `src_2_name`, … | Source port labels from the router                       |
| `dst_1_name`, `dst_2_name`, … | Destination port labels from the router                  |
| `dst_1_lock_state`, …         | Destination lock state (`Unlocked` / `Locked` / `Owned`) |
| `xpt_v_1`                     | Source ID routed to destination 1 (video level)          |
| `xpt_a_1`, `xpt_b_1`, …       | Active source IDs for other configured levels            |
| `xpt_v_2`, etc.               | Crosspoint state for each destination × level            |

### Feedbacks

| Feedback               | Description                                  |
| ---------------------- | -------------------------------------------- |
| **Destination Locked** | True when the selected destination is locked |

Crosspoint variables update in real-time when routes change from any source (Companion, panels, other controllers). Which levels are tracked is set by the Level System config (8 / 16 / MAGNUM). This feature can be disabled in config for large routers to reduce variable count. Source/destination name and lock-state variables are always available.

### Config Options

| Option                          | Description                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ |
| **IP Address**                  | Router IP address                                                              |
| **Port**                        | TCP port (default 23)                                                          |
| **Max Destinations**            | Set to match your router configuration                                         |
| **Max Sources**                 | Set to match your router configuration                                         |
| **Polling Interval**            | How often to refresh names and crosspoints (seconds)                           |
| **Expose Crosspoint Variables** | Enable/disable `xpt_*` variables                                               |
| **Level System**                | 8 Level, 16 Level, or MAGNUM — controls which levels get variables and polling |
| **Verbose Logging**             | Log all sent and received data for troubleshooting                             |

Source and destination names refresh automatically on connection and at the polling interval. Crosspoint state also updates in real-time via router notifications.

### Salvo IDs

To view salvo IDs on MAGNUM systems without downloading the config file, visit:

```
http://[MAGNUM_IP]/magnum/controls/listPreset
```

You must be logged in to access listPreset.
