package ch.dorianko.rwtfwifiscanner.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import ch.dorianko.rwtfwifiscanner.R
import ch.dorianko.rwtfwifiscanner.data.db.RouterInfo

class RouterInfoAdapter : ListAdapter<RouterInfo, RouterInfoAdapter.RouterViewHolder>(
    RouterDiffCallback()
) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RouterViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_router_info, parent, false)
        return RouterViewHolder(view)
    }

    override fun onBindViewHolder(holder: RouterViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class RouterViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val nameTextView: TextView = itemView.findViewById(R.id.tvRouterName)
        private val coordsTextView: TextView = itemView.findViewById(R.id.tvCoordinates)
        private val bssidTextView: TextView = itemView.findViewById(R.id.tvBssid)

        fun bind(routerInfo: RouterInfo) {
            nameTextView.text = "${routerInfo.name} (ID ${routerInfo.id}"
            coordsTextView.text = "Coords: ${routerInfo.latitude}, ${routerInfo.longitude}"
            bssidTextView.text = "BSSID: ${routerInfo.bssid}"
        }
    }
}

class RouterDiffCallback : DiffUtil.ItemCallback<RouterInfo>() {
    override fun areItemsTheSame(oldItem: RouterInfo, newItem: RouterInfo): Boolean {
        //return oldItem.bssid == newItem.bssid
        return oldItem.id == newItem.id;
    }

    override fun areContentsTheSame(oldItem: RouterInfo, newItem: RouterInfo): Boolean {
        return oldItem == newItem
    }
}