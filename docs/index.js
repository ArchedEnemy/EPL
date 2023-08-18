importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.4/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.4/dist/wheels/panel-0.14.4-py3-none-any.whl', 'pyodide-http==0.1.0', 'bs4', 'datetime', 'holoviews>=1.15.4', 'hvplot', 'json', 'numpy', 'pandas', 're', 'requests']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

#-----------------------------------------------
# PLAYERS
#-----------------------------------------------
import requests
from bs4 import BeautifulSoup
import json
import pandas as pd
import re

import panel as pn
pn.extension('tabulator', sizing_mode="stretch_width")
import hvplot.pandas
from bokeh.models.widgets.tables import NumberFormatter
import datetime as dt
import numpy as np 

# Entering the league's  link
link = "https://understat.com/league/epl"
res = requests.get(link)
soup = BeautifulSoup(res.content,'lxml')
scripts = soup.find_all('script')
# Get the players stats 
strings = scripts[3].string 
# Getting rid of unnecessary characters from json data
ind_start = strings.index("('")+2 
ind_end = strings.index("')") 
json_data = strings[ind_start:ind_end] 
json_data = json_data.encode('utf8').decode('unicode_escape')
data = json.loads(json_data)
# Creating the dataframe
players = pd.DataFrame(data)
players['position_main'] = players['position'].str.split(' ').str[0]


#-----------------------------------------------
# SHOTS
#-----------------------------------------------
df = pd.read_csv('https://raw.githubusercontent.com/ArchedEnemy/EPL/main/shots23.csv', parse_dates = ['date'], dayfirst=True)
#df = pd.read_csv(r'X:\understat23.csv', parse_dates = ['date'], dayfirst=True)
df['own_goal'] =  np.where(df['result'] == 'OwnGoal', 1, 0)
df['dist_to_goal'] =  (((1 - df['x'])**2 + (0.5 - df['y'])**2)**(1/2))*95.65217391
df['dist_to_goal'] = df['dist_to_goal'].round(2)

players = players.rename(columns={'id': 'playerId'})
players['playerId'] = players['playerId'].astype('int')
df = pd.merge(df, players[['playerId','position_main']],how='left', on=['playerId'])


teams = pn.widgets.MultiSelect(options=list(df['team'].unique()),name='Team',value=list(df['team'].unique()),size=10)
positions = pn.widgets.MultiSelect(options=list(df['position_main'].unique()),name='Position',value=list(df['position_main'].unique()),size=10)

def input_function1(team, position):
    df3 = df[df['team'].isin(teams.value)]
    df3 = df3[df3['position_main'].isin(positions.value)]
    df3['%ShotsOnTarget'] = df3['onTarget']/df3['shot']
    df3['GoalsPerShot'] = df3['goal']/df3['shot']
    df4 = df3.groupby(['player','team', 'position_main']).aggregate({'shot':'sum','onTarget':'sum','%ShotsOnTarget':'mean','goal':'sum','xG':'sum','GoalsPerShot':'mean'})
    df4['xG_Diff'] = df4['goal']-df4['xG']
    df4 = df4.reset_index()
    assist_df = df3.groupby(['player_assist','team']).aggregate({'shot':'sum','goal':'sum','xG':'sum'})
    assist_df = assist_df.reset_index()
    assist_df = assist_df.rename(columns={'player_assist': 'player','shot': 'attAssists','goal': 'Assists','xG': 'xA'})
    assist_df['xA_Diff'] = assist_df['Assists']-assist_df['xA']
    assist_df['xA'] = assist_df['xA'].fillna(0) 
    assist_df['Assists'] = assist_df['Assists'].fillna(0) 
    assist_df['attAssists'] = assist_df['attAssists'].fillna(0) 
    assist_df['xA_Diff'] = assist_df['xA_Diff'].fillna(0) 
    df5 = pd.merge(df4, assist_df,how='left', on=['player','team']).sort_values(by='goal', ascending=False)
    df5 = df5[['player', 'team', 'position_main', 'shot', 'onTarget', '%ShotsOnTarget', 'goal', 'xG', 'xG_Diff', 'attAssists', 'Assists', 'xA', 'xA_Diff', 'GoalsPerShot']]

    bokeh_formatters = {
    'xG': NumberFormatter(format='0.00'),
    '%ShotsOnTarget': NumberFormatter(format='0.0%'),
    'xG_Diff': NumberFormatter(format='0.00'),
    'xG': NumberFormatter(format='0.00'),
    'attAssists': NumberFormatter(format='0.'),
    'Assists': NumberFormatter(format='0.'),
    'xA': NumberFormatter(format='0.00'),
    'xA_Diff': NumberFormatter(format='0.00'),
    'GoalsPerShot': {'type': 'progress', 'max': 1}
    }

    col_filters = {
        'player': {'type': 'input', 'func': 'like', 'placeholder': 'search player'}
        ,'team': {'type': 'input', 'func': 'like', 'placeholder': 'search team'}
        #,'position_main': {'type': 'input', 'func': 'like', 'placeholder': 'position'}
    }
    
    return pn.widgets.Tabulator(df5, frozen_columns=['player','team'], pagination='local', formatters=bokeh_formatters, page_size=10, show_index=False, header_filters=col_filters)
  
pn.Column(pn.Row(positions,teams), hvplot.bind(input_function1, teams, positions)).servable()

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()